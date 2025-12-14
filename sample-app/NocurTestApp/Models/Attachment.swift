import SwiftUI
import Foundation

// MARK: - Attachment Model

struct Attachment: Identifiable, Equatable {
    let id = UUID()
    let type: AttachmentType
    
    static func == (lhs: Attachment, rhs: Attachment) -> Bool {
        lhs.id == rhs.id
    }
}

// MARK: - Attachment Type

enum AttachmentType {
    case image(UIImage)
    case pdf(URL, pageCount: Int, fileName: String)
    case file(URL, fileName: String, fileType: String)
    
    var displayName: String {
        switch self {
        case .image:
            return "Image"
        case .pdf(_, _, let fileName):
            return fileName
        case .file(_, let fileName, _):
            return fileName
        }
    }
    
    var iconName: String {
        switch self {
        case .image:
            return "photo"
        case .pdf:
            return "doc.fill"
        case .file(_, _, let fileType):
            switch fileType.lowercased() {
            case "txt", "md", "rtf":
                return "doc.text"
            case "swift", "py", "js", "ts", "java", "cpp", "c", "h":
                return "chevron.left.forwardslash.chevron.right"
            case "json", "xml", "yaml", "yml":
                return "curlybraces"
            default:
                return "doc"
            }
        }
    }
}
