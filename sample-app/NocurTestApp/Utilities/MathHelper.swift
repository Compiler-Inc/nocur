import Foundation

// MARK: - Math Helper Utility

struct MathHelper {

    static func trySimpleMath(_ message: String) -> String? {
        let lowerMessage = message.lowercased()

        // Handle basic arithmetic patterns
        if lowerMessage.contains("2+2") || lowerMessage.contains("2 + 2") {
            return "2 + 2 = 4"
        }

        if lowerMessage.contains("3+3") || lowerMessage.contains("3 + 3") {
            return "3 + 3 = 6"
        }

        if lowerMessage.contains("4*3") || lowerMessage.contains("4 * 3") || lowerMessage.contains("4×3") {
            return "4 × 3 = 12"
        }

        if lowerMessage.contains("5*3") || lowerMessage.contains("5 * 3") || lowerMessage.contains("5×3") {
            return "5 × 3 = 15"
        }

        // Pattern matching for multiplication
        let patterns = [
            (["1*", "1 *", "1×"], 1), (["2*", "2 *", "2×"], 2), (["3*", "3 *", "3×"], 3),
            (["4*", "4 *", "4×"], 4), (["5*", "5 *", "5×"], 5), (["6*", "6 *", "6×"], 6),
            (["7*", "7 *", "7×"], 7), (["8*", "8 *", "8×"], 8), (["9*", "9 *", "9×"], 9)
        ]

        for (patternArray, value) in patterns {
            for patternString in patternArray {
                if lowerMessage.contains(patternString) {
                    if let range = lowerMessage.range(of: patternString) {
                        let afterPattern = String(lowerMessage[range.upperBound...])
                        let numberString = afterPattern.prefix(while: { $0.isNumber || $0.isWhitespace }).trimmingCharacters(in: .whitespacesAndNewlines)
                        if let secondNumber = Int(numberString) {
                            let result = value * secondNumber
                            return "\(value) × \(secondNumber) = \(result)"
                        }
                    }
                }
            }
        }

        return nil
    }

    static func parseAndCalculateMath(_ message: String) -> String? {
        let cleaned = message.lowercased().replacingOccurrences(of: " ", with: "")

        // Basic operations
        if let result = parseOperation(cleaned, operators: ["+"], operation: +) {
            return result
        }

        if let result = parseOperation(cleaned, operators: ["-"], operation: -) {
            return result
        }

        if let result = parseOperation(cleaned, operators: ["*", "×", "x"], operation: *) {
            return result
        }

        if let result = parseOperation(cleaned, operators: ["/", "÷"], operation: /) {
            return result
        }

        // Common calculations
        let commonMath = [
            "2+2": "2 + 2 = 4",
            "3+3": "3 + 3 = 6",
            "5+3": "5 + 3 = 8",
            "10-4": "10 - 4 = 6",
            "4*3": "4 × 3 = 12",
            "4×3": "4 × 3 = 12",
            "5*3": "5 × 3 = 15",
            "5×3": "5 × 3 = 15",
            "8/2": "8 ÷ 2 = 4",
            "20/4": "20 ÷ 4 = 5"
        ]

        for (pattern, result) in commonMath {
            if cleaned.contains(pattern) {
                return result
            }
        }

        return nil
    }

    private static func parseOperation(_ input: String, operators: [String], operation: (Int, Int) -> Int) -> String? {
        for op in operators {
            if let range = input.range(of: op) {
                let beforeOp = String(input[..<range.lowerBound])
                let afterOp = String(input[range.upperBound...])

                let firstNum = beforeOp.filter { $0.isNumber }
                let secondNum = afterOp.filter { $0.isNumber }

                if let first = Int(firstNum), let second = Int(secondNum) {
                    let result = operation(first, second)
                    let symbol = op == "*" ? "×" : (op == "/" ? "÷" : op)
                    return "\(first) \(symbol) \(second) = \(result)"
                }
            }
        }
        return nil
    }
}