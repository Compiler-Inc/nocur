import SwiftUI

// MARK: - Attachment Preview (shown before sending)

struct AttachmentPreviewBar: View {
    let attachments: [Attachment]
    let onRemove: (Attachment) -> Void

    private var bgElevated: Color { Color(red: 0.11, green: 0.11, blue: 0.12) }
    private var accent: Color { Color(red: 0.92, green: 0.75, blue: 0.45) }

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(attachments) { attachment in
                    AttachmentPreviewItem(
                        attachment: attachment,
                        onRemove: { onRemove(attachment) }
                    )
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
        }
        .background(bgElevated.opacity(0.5))
    }
}

// MARK: - Individual Attachment Preview

struct AttachmentPreviewItem: View {
    let attachment: Attachment
    let onRemove: () -> Void

    private var bgElevated: Color { Color(red: 0.15, green: 0.15, blue: 0.16) }
    private var textPrimary: Color { Color(white: 0.95) }
    private var textSecondary: Color { Color(white: 0.55) }
    private var accent: Color { Color(red: 0.92, green: 0.75, blue: 0.45) }

    var body: some View {
        ZStack(alignment: .topTrailing) {
            attachmentContent
                .frame(width: 80, height: 80)
                .clipShape(RoundedRectangle(cornerRadius: 12))
                .overlay(
                    RoundedRectangle(cornerRadius: 12)
                        .stroke(Color.white.opacity(0.1), lineWidth: 1)
                )

            // Remove button
            Button(action: onRemove) {
                Image(systemName: "xmark.circle.fill")
                    .font(.system(size: 20))
                    .foregroundStyle(.white)
                    .background(
                        Circle()
                            .fill(Color.black.opacity(0.6))
                            .frame(width: 18, height: 18)
                    )
            }
            .offset(x: 6, y: -6)
        }
    }

    @ViewBuilder
    private var attachmentContent: some View {
        switch attachment.type {
        case .image(let image):
            Image(uiImage: image)
                .resizable()
                .aspectRatio(contentMode: .fill)

        case .pdf(_, let pageCount, let fileName):
            VStack(spacing: 4) {
                Image(systemName: "doc.fill")
                    .font(.system(size: 24))
                    .foregroundStyle(accent)
                Text(fileName.prefix(10) + (fileName.count > 10 ? "..." : ""))
                    .font(.system(size: 10))
                    .foregroundStyle(textSecondary)
                    .lineLimit(1)
                Text("\(pageCount) page\(pageCount == 1 ? "" : "s")")
                    .font(.system(size: 9))
                    .foregroundStyle(textSecondary.opacity(0.7))
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(bgElevated)

        case .file(_, let fileName, _):
            VStack(spacing: 4) {
                Image(systemName: attachment.type.iconName)
                    .font(.system(size: 24))
                    .foregroundStyle(accent)
                Text(fileName.prefix(10) + (fileName.count > 10 ? "..." : ""))
                    .font(.system(size: 10))
                    .foregroundStyle(textSecondary)
                    .lineLimit(1)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(bgElevated)
        }
    }
}

// MARK: - Attachment Display in Message Bubble

struct AttachmentBubble: View {
    let attachment: Attachment
    let isUser: Bool

    private var bgElevated: Color { Color(red: 0.11, green: 0.11, blue: 0.12) }
    private var textPrimary: Color { Color(white: 0.95) }
    private var textSecondary: Color { Color(white: 0.55) }
    private var accent: Color { Color(red: 0.92, green: 0.75, blue: 0.45) }

    var body: some View {
        Group {
            switch attachment.type {
            case .image(let image):
                ImageAttachmentView(image: image, isUser: isUser)

            case .pdf(_, let pageCount, let fileName):
                FileAttachmentView(
                    fileName: fileName,
                    fileInfo: "\(pageCount) page\(pageCount == 1 ? "" : "s")",
                    iconName: "doc.fill",
                    isUser: isUser
                )

            case .file(_, let fileName, let fileType):
                FileAttachmentView(
                    fileName: fileName,
                    fileInfo: fileType.uppercased(),
                    iconName: attachment.type.iconName,
                    isUser: isUser
                )
            }
        }
    }
}

// MARK: - Image Attachment View

struct ImageAttachmentView: View {
    let image: UIImage
    let isUser: Bool

    @State private var showFullScreen = false

    private var accent: Color { Color(red: 0.92, green: 0.75, blue: 0.45) }

    var body: some View {
        Image(uiImage: image)
            .resizable()
            .aspectRatio(contentMode: .fit)
            .frame(maxWidth: 250, maxHeight: 300)
            .clipShape(RoundedRectangle(cornerRadius: 12))
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .stroke(isUser ? accent.opacity(0.3) : Color.white.opacity(0.1), lineWidth: 1)
            )
            .onTapGesture {
                showFullScreen = true
            }
            .fullScreenCover(isPresented: $showFullScreen) {
                FullScreenImageView(image: image, isPresented: $showFullScreen)
            }
    }
}

// MARK: - Full Screen Image View

struct FullScreenImageView: View {
    let image: UIImage
    @Binding var isPresented: Bool

    @State private var scale: CGFloat = 1.0
    @State private var lastScale: CGFloat = 1.0

    private var bgBase: Color { Color(red: 0.07, green: 0.07, blue: 0.08) }

    var body: some View {
        ZStack {
            bgBase.ignoresSafeArea()

            Image(uiImage: image)
                .resizable()
                .aspectRatio(contentMode: .fit)
                .scaleEffect(scale)
                .gesture(
                    MagnificationGesture()
                        .onChanged { value in
                            scale = lastScale * value
                        }
                        .onEnded { _ in
                            lastScale = scale
                            if scale < 1.0 {
                                withAnimation {
                                    scale = 1.0
                                    lastScale = 1.0
                                }
                            }
                        }
                )
                .onTapGesture(count: 2) {
                    withAnimation {
                        if scale > 1.0 {
                            scale = 1.0
                            lastScale = 1.0
                        } else {
                            scale = 2.0
                            lastScale = 2.0
                        }
                    }
                }
        }
        .overlay(alignment: .topTrailing) {
            Button {
                isPresented = false
            } label: {
                Image(systemName: "xmark.circle.fill")
                    .font(.system(size: 28))
                    .foregroundStyle(.white.opacity(0.8))
                    .padding()
            }
        }
    }
}

// MARK: - File Attachment View

struct FileAttachmentView: View {
    let fileName: String
    let fileInfo: String
    let iconName: String
    let isUser: Bool

    private var bgElevated: Color { Color(red: 0.11, green: 0.11, blue: 0.12) }
    private var textPrimary: Color { Color(white: 0.95) }
    private var textSecondary: Color { Color(white: 0.55) }
    private var accent: Color { Color(red: 0.92, green: 0.75, blue: 0.45) }

    var body: some View {
        HStack(spacing: 12) {
            ZStack {
                RoundedRectangle(cornerRadius: 8)
                    .fill(isUser ? Color.black.opacity(0.2) : accent.opacity(0.15))
                    .frame(width: 44, height: 44)

                Image(systemName: iconName)
                    .font(.system(size: 20))
                    .foregroundStyle(isUser ? .black.opacity(0.7) : accent)
            }

            VStack(alignment: .leading, spacing: 2) {
                Text(fileName)
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(isUser ? .black : textPrimary)
                    .lineLimit(1)

                Text(fileInfo)
                    .font(.system(size: 12))
                    .foregroundStyle(isUser ? .black.opacity(0.6) : textSecondary)
            }

            Spacer()
        }
        .padding(12)
        .background(isUser ? accent : bgElevated)
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .frame(maxWidth: 250)
    }
}

#Preview {
    VStack(spacing: 20) {
        // Preview with mock attachments
        let mockImage = UIImage(systemName: "photo.fill")!
        let imageAttachment = Attachment(type: .image(mockImage))
        let pdfAttachment = Attachment(type: .pdf(URL(fileURLWithPath: "/test.pdf"), pageCount: 5, fileName: "Document.pdf"))

        AttachmentPreviewBar(
            attachments: [imageAttachment, pdfAttachment],
            onRemove: { _ in }
        )

        AttachmentBubble(attachment: pdfAttachment, isUser: false)
        AttachmentBubble(attachment: pdfAttachment, isUser: true)
    }
    .padding()
    .background(Color(red: 0.07, green: 0.07, blue: 0.08))
}
