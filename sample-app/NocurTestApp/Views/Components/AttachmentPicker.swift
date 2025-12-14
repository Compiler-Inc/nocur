import SwiftUI
import PhotosUI
import UniformTypeIdentifiers
import PDFKit

// MARK: - Attachment Picker Manager

@MainActor
class AttachmentPickerManager: ObservableObject {
    @Published var selectedAttachments: [Attachment] = []
    @Published var showPhotoPicker = false
    @Published var showCamera = false
    @Published var showFilePicker = false
    @Published var showActionSheet = false
    @Published var errorMessage: String?

    // PhotosUI selection
    @Published var photoSelection: [PhotosPickerItem] = []

    func handlePhotoSelection(_ items: [PhotosPickerItem]) {
        Task {
            for item in items {
                if let data = try? await item.loadTransferable(type: Data.self),
                   let image = UIImage(data: data) {
                    let attachment = Attachment(type: .image(image))
                    await MainActor.run {
                        selectedAttachments.append(attachment)
                    }
                }
            }
        }
    }

    func addImage(_ image: UIImage) {
        let attachment = Attachment(type: .image(image))
        selectedAttachments.append(attachment)
    }

    func addFile(url: URL) {
        // Start accessing the security-scoped resource
        guard url.startAccessingSecurityScopedResource() else {
            errorMessage = "Unable to access the selected file"
            return
        }
        defer { url.stopAccessingSecurityScopedResource() }

        let fileName = url.lastPathComponent
        let fileExtension = url.pathExtension.lowercased()

        // Handle PDF files
        if fileExtension == "pdf" {
            if let pdfDocument = PDFDocument(url: url) {
                let pageCount = pdfDocument.pageCount
                // Copy to temp directory for later access
                let tempURL = copyToTempDirectory(url: url)
                let attachment = Attachment(type: .pdf(tempURL ?? url, pageCount: pageCount, fileName: fileName))
                selectedAttachments.append(attachment)
            } else {
                errorMessage = "Unable to read PDF file"
            }
        } else {
            // Handle other files
            let tempURL = copyToTempDirectory(url: url)
            let attachment = Attachment(type: .file(tempURL ?? url, fileName: fileName, fileType: fileExtension))
            selectedAttachments.append(attachment)
        }
    }

    private func copyToTempDirectory(url: URL) -> URL? {
        let tempDir = FileManager.default.temporaryDirectory
        let tempURL = tempDir.appendingPathComponent(url.lastPathComponent)

        do {
            // Remove existing file if any
            if FileManager.default.fileExists(atPath: tempURL.path) {
                try FileManager.default.removeItem(at: tempURL)
            }
            try FileManager.default.copyItem(at: url, to: tempURL)
            return tempURL
        } catch {
            print("Failed to copy file: \(error)")
            return nil
        }
    }

    func removeAttachment(_ attachment: Attachment) {
        selectedAttachments.removeAll { $0.id == attachment.id }
    }

    func clearAttachments() {
        selectedAttachments.removeAll()
    }
}

// MARK: - Attachment Button (Plus button)

struct AttachmentButton: View {
    @ObservedObject var manager: AttachmentPickerManager
    let disabled: Bool

    private var textSecondary: Color { Color(white: 0.55) }
    private var textTertiary: Color { Color(white: 0.35) }
    private var accent: Color { Color(red: 0.92, green: 0.75, blue: 0.45) }

    var body: some View {
        Button {
            manager.showActionSheet = true
        } label: {
            Image(systemName: "plus.circle.fill")
                .font(.system(size: 24))
                .foregroundStyle(disabled ? textTertiary : accent)
        }
        .disabled(disabled)
        .confirmationDialog("Add Attachment", isPresented: $manager.showActionSheet) {
            Button("Photo Library") {
                manager.showPhotoPicker = true
            }

            Button("Take Photo") {
                manager.showCamera = true
            }

            Button("Choose File") {
                manager.showFilePicker = true
            }

            Button("Cancel", role: .cancel) {}
        }
        .photosPicker(
            isPresented: $manager.showPhotoPicker,
            selection: $manager.photoSelection,
            maxSelectionCount: 5,
            matching: .images
        )
        .onChange(of: manager.photoSelection) { newValue in
            manager.handlePhotoSelection(newValue)
            manager.photoSelection = []
        }
        .sheet(isPresented: $manager.showCamera) {
            CameraView { image in
                manager.addImage(image)
            }
        }
        .fileImporter(
            isPresented: $manager.showFilePicker,
            allowedContentTypes: [.pdf, .plainText, .json, .commaSeparatedText, .image],
            allowsMultipleSelection: true
        ) { result in
            switch result {
            case .success(let urls):
                for url in urls {
                    manager.addFile(url: url)
                }
            case .failure(let error):
                manager.errorMessage = error.localizedDescription
            }
        }
    }
}

// MARK: - Camera View

struct CameraView: UIViewControllerRepresentable {
    let onImageCaptured: (UIImage) -> Void
    @Environment(\.dismiss) private var dismiss

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ uiViewController: UIImagePickerController, context: Context) {}

    func makeCoordinator() -> Coordinator {
        Coordinator(self)
    }

    class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let parent: CameraView

        init(_ parent: CameraView) {
            self.parent = parent
        }

        func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            if let image = info[.originalImage] as? UIImage {
                parent.onImageCaptured(image)
            }
            parent.dismiss()
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
            parent.dismiss()
        }
    }
}

// MARK: - Attachment Type Indicator

struct AttachmentTypeIndicator: View {
    let attachments: [Attachment]

    private var textSecondary: Color { Color(white: 0.55) }

    var body: some View {
        if !attachments.isEmpty {
            HStack(spacing: 4) {
                ForEach(attachmentTypes, id: \.self) { iconName in
                    Image(systemName: iconName)
                        .font(.system(size: 12))
                        .foregroundStyle(textSecondary)
                }

                Text("\(attachments.count)")
                    .font(.system(size: 12))
                    .foregroundStyle(textSecondary)
            }
        }
    }

    private var attachmentTypes: [String] {
        var types = Set<String>()
        for attachment in attachments {
            types.insert(attachment.type.iconName)
        }
        return Array(types).sorted()
    }
}

#Preview {
    struct PreviewWrapper: View {
        @StateObject var manager = AttachmentPickerManager()

        var body: some View {
            VStack {
                AttachmentButton(manager: manager, disabled: false)

                if !manager.selectedAttachments.isEmpty {
                    AttachmentPreviewBar(
                        attachments: manager.selectedAttachments,
                        onRemove: { manager.removeAttachment($0) }
                    )
                }
            }
            .padding()
            .background(Color(red: 0.07, green: 0.07, blue: 0.08))
        }
    }

    return PreviewWrapper()
}
