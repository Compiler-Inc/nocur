//! Window capture module for embedding Simulator.app
//!
//! This module captures the Simulator.app window and streams frames
//! to the frontend for a live embedded simulator experience.

use core_foundation::base::TCFType;
use core_foundation::dictionary::CFDictionaryRef;
use core_foundation::number::CFNumber;
use core_foundation::string::CFString;
use core_graphics::display::{
    kCGNullWindowID, kCGWindowListExcludeDesktopElements, kCGWindowListOptionIncludingWindow,
    CGWindowListCopyWindowInfo, CGWindowListCreateImage,
};
use core_graphics::event::{CGEvent, CGEventTapLocation, CGEventType, CGMouseButton};
use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};
use core_graphics::geometry::{CGPoint, CGRect, CGSize};
use core_graphics::sys::CGImageRef;
use parking_lot::RwLock;

// FFI declarations for CGImage functions not exposed by the crate
extern "C" {
    fn CGImageGetWidth(image: CGImageRef) -> usize;
    fn CGImageGetHeight(image: CGImageRef) -> usize;
}
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use image::ImageEncoder;

/// Window info for the simulator
#[derive(Debug, Clone, serde::Serialize)]
pub struct SimulatorWindowInfo {
    pub window_id: u32,
    pub bounds: WindowBounds,
    pub name: String,
    pub owner_name: String,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct WindowBounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// Frame data sent to frontend
#[derive(Clone, serde::Serialize)]
pub struct FrameData {
    /// Base64 encoded PNG image
    pub image: String,
    pub width: u32,
    pub height: u32,
    pub timestamp: u64,
}

/// Global state for window capture
pub struct WindowCaptureState {
    streaming: AtomicBool,
    window_id: AtomicU32,
    window_bounds: RwLock<Option<WindowBounds>>,
}

impl WindowCaptureState {
    pub fn new() -> Self {
        Self {
            streaming: AtomicBool::new(false),
            window_id: AtomicU32::new(0),
            window_bounds: RwLock::new(None),
        }
    }

    pub fn is_streaming(&self) -> bool {
        self.streaming.load(Ordering::SeqCst)
    }

    pub fn set_streaming(&self, value: bool) {
        self.streaming.store(value, Ordering::SeqCst);
    }

    pub fn get_window_id(&self) -> u32 {
        self.window_id.load(Ordering::SeqCst)
    }

    pub fn set_window_id(&self, id: u32) {
        self.window_id.store(id, Ordering::SeqCst);
    }

    pub fn set_bounds(&self, bounds: WindowBounds) {
        *self.window_bounds.write() = Some(bounds);
    }

    pub fn get_bounds(&self) -> Option<WindowBounds> {
        self.window_bounds.read().clone()
    }
}

// Helper to get string from CFDictionary
unsafe fn get_dict_string(dict: CFDictionaryRef, key: &str) -> Option<String> {
    use core_foundation::base::CFType;
    use core_foundation::dictionary::CFDictionary;

    let cf_dict = CFDictionary::<CFString, CFType>::wrap_under_get_rule(dict);
    let cf_key = CFString::new(key);

    cf_dict.find(cf_key).map(|value| {
        let cf_str = CFString::wrap_under_get_rule(value.as_concrete_TypeRef() as _);
        cf_str.to_string()
    })
}

// Helper to get number from CFDictionary
unsafe fn get_dict_number(dict: CFDictionaryRef, key: &str) -> Option<i64> {
    use core_foundation::base::CFType;
    use core_foundation::dictionary::CFDictionary;

    let cf_dict = CFDictionary::<CFString, CFType>::wrap_under_get_rule(dict);
    let cf_key = CFString::new(key);

    cf_dict.find(cf_key).and_then(|value| {
        let cf_num = CFNumber::wrap_under_get_rule(value.as_concrete_TypeRef() as _);
        cf_num.to_i64()
    })
}

// Helper to get nested dictionary value
unsafe fn get_dict_bounds(dict: CFDictionaryRef, key: &str) -> Option<WindowBounds> {
    use core_foundation::base::CFType;
    use core_foundation::dictionary::CFDictionary;

    let cf_dict = CFDictionary::<CFString, CFType>::wrap_under_get_rule(dict);
    let cf_key = CFString::new(key);

    cf_dict.find(cf_key).map(|value| {
        let bounds_dict = value.as_concrete_TypeRef() as CFDictionaryRef;

        let x = get_dict_number(bounds_dict, "X").unwrap_or(0) as f64;
        let y = get_dict_number(bounds_dict, "Y").unwrap_or(0) as f64;
        let width = get_dict_number(bounds_dict, "Width").unwrap_or(0) as f64;
        let height = get_dict_number(bounds_dict, "Height").unwrap_or(0) as f64;

        WindowBounds { x, y, width, height }
    })
}

/// Find the Simulator.app device window
pub fn find_simulator_window() -> Result<SimulatorWindowInfo, String> {
    unsafe {
        // Get list of all windows
        let window_list = CGWindowListCopyWindowInfo(
            kCGWindowListExcludeDesktopElements,
            kCGNullWindowID,
        );

        if window_list.is_null() {
            return Err("Failed to get window list".to_string());
        }

        let count = core_foundation::array::CFArrayGetCount(window_list);

        for i in 0..count {
            let window_dict =
                core_foundation::array::CFArrayGetValueAtIndex(window_list, i) as CFDictionaryRef;

            // Get owner name
            let owner_name = get_dict_string(window_dict, "kCGWindowOwnerName").unwrap_or_default();

            // We want Simulator windows
            if owner_name != "Simulator" {
                continue;
            }

            // Get window name
            let window_name = get_dict_string(window_dict, "kCGWindowName").unwrap_or_default();

            // Skip windows without names (toolbar, etc) - we want the device window
            // Device windows are named like "iPhone 16 Pro" or similar
            if window_name.is_empty() || window_name == "Simulator" {
                continue;
            }

            // Get window ID
            let window_id = get_dict_number(window_dict, "kCGWindowNumber").unwrap_or(0) as u32;

            // Get bounds
            let bounds = get_dict_bounds(window_dict, "kCGWindowBounds")
                .unwrap_or(WindowBounds {
                    x: 0.0,
                    y: 0.0,
                    width: 0.0,
                    height: 0.0,
                });

            // Found a device window!
            if window_id > 0 && bounds.width > 100.0 && bounds.height > 100.0 {
                core_foundation::base::CFRelease(window_list as _);
                return Ok(SimulatorWindowInfo {
                    window_id,
                    bounds,
                    name: window_name,
                    owner_name,
                });
            }
        }

        core_foundation::base::CFRelease(window_list as _);
        Err("No Simulator device window found. Is Simulator.app open?".to_string())
    }
}

/// Capture a single frame from the simulator window using CGWindowListCreateImage
/// Returns PNG data as base64
pub fn capture_frame(window_id: u32) -> Result<FrameData, String> {
    unsafe {
        let rect = CGRect::new(&CGPoint::new(0.0, 0.0), &CGSize::new(0.0, 0.0));

        let image_ref = CGWindowListCreateImage(
            rect,
            kCGWindowListOptionIncludingWindow,
            window_id,
            0,
        );

        if image_ref.is_null() {
            return Err("Failed to capture window".to_string());
        }

        // Get image dimensions
        let width = CGImageGetWidth(image_ref) as u32;
        let height = CGImageGetHeight(image_ref) as u32;

        // Create a bitmap context to draw the image into
        let color_space = core_graphics::color_space::CGColorSpace::create_device_rgb();
        let bytes_per_row = width * 4;
        let mut pixel_data: Vec<u8> = vec![0; (bytes_per_row * height) as usize];

        let context = core_graphics::context::CGContext::create_bitmap_context(
            Some(pixel_data.as_mut_ptr() as *mut _),
            width as usize,
            height as usize,
            8,
            bytes_per_row as usize,
            &color_space,
            core_graphics::base::kCGImageAlphaPremultipliedLast,
        );

        // Draw the captured image into our context
        let draw_rect = CGRect::new(
            &CGPoint::new(0.0, 0.0),
            &CGSize::new(width as f64, height as f64),
        );

        use foreign_types_shared::ForeignType;
        let cg_image = core_graphics::image::CGImage::from_ptr(image_ref);
        context.draw_image(draw_rect, &cg_image);

        // Convert RGBA to PNG
        let img = image::RgbaImage::from_raw(width, height, pixel_data)
            .ok_or("Failed to create image buffer")?;

        // Encode to PNG
        let mut buffer = Vec::new();
        let encoder = image::codecs::png::PngEncoder::new(&mut buffer);
        encoder
            .write_image(&img, width, height, image::ExtendedColorType::Rgba8)
            .map_err(|e| format!("PNG encode error: {}", e))?;

        // Encode as base64
        let base64_data = BASE64.encode(&buffer);

        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;

        Ok(FrameData {
            image: format!("data:image/png;base64,{}", base64_data),
            width,
            height,
            timestamp,
        })
    }
}

/// Send a mouse click to the simulator window
pub fn send_mouse_click(x: f64, y: f64, bounds: &WindowBounds) -> Result<(), String> {
    // Convert relative coordinates (0-1) to absolute screen coordinates
    let abs_x = bounds.x + (x * bounds.width);
    let abs_y = bounds.y + (y * bounds.height);

    let source = CGEventSource::new(CGEventSourceStateID::HIDSystemState)
        .map_err(|_| "Failed to create event source")?;

    let point = CGPoint::new(abs_x, abs_y);

    // Mouse down
    let mouse_down = CGEvent::new_mouse_event(
        source.clone(),
        CGEventType::LeftMouseDown,
        point,
        CGMouseButton::Left,
    )
    .map_err(|_| "Failed to create mouse down event")?;
    mouse_down.post(CGEventTapLocation::HID);

    // Small delay
    std::thread::sleep(std::time::Duration::from_millis(50));

    // Mouse up
    let mouse_up = CGEvent::new_mouse_event(
        source,
        CGEventType::LeftMouseUp,
        point,
        CGMouseButton::Left,
    )
    .map_err(|_| "Failed to create mouse up event")?;
    mouse_up.post(CGEventTapLocation::HID);

    Ok(())
}

/// Start streaming frames to the frontend
pub async fn start_streaming(
    app_handle: AppHandle,
    state: Arc<WindowCaptureState>,
    fps: u32,
) -> Result<(), String> {
    // Find the simulator window
    let window_info = find_simulator_window()?;

    log::info!(
        "Found simulator window: {} (id: {})",
        window_info.name,
        window_info.window_id
    );

    state.set_window_id(window_info.window_id);
    state.set_bounds(window_info.bounds.clone());
    state.set_streaming(true);

    // Emit window info
    let _ = app_handle.emit("simulator-window-found", &window_info);

    let frame_interval = std::time::Duration::from_millis(1000 / fps as u64);

    // Spawn frame capture loop
    let state_clone = state.clone();
    tokio::spawn(async move {
        while state_clone.is_streaming() {
            let window_id = state_clone.get_window_id();

            match capture_frame(window_id) {
                Ok(frame) => {
                    let _ = app_handle.emit("simulator-frame", frame);
                }
                Err(e) => {
                    log::warn!("Frame capture error: {}", e);
                    // Window might have closed, try to find it again
                    if let Ok(info) = find_simulator_window() {
                        state_clone.set_window_id(info.window_id);
                        state_clone.set_bounds(info.bounds);
                    } else {
                        // Simulator closed, stop streaming
                        state_clone.set_streaming(false);
                        let _ = app_handle.emit("simulator-disconnected", ());
                        break;
                    }
                }
            }

            tokio::time::sleep(frame_interval).await;
        }

        log::info!("Stopped frame streaming");
    });

    Ok(())
}

/// Stop streaming
pub fn stop_streaming(state: &WindowCaptureState) {
    state.set_streaming(false);
}
