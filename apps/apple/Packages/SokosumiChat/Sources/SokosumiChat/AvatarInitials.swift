import Foundation

public func avatarInitials(from name: String) -> String {
  let words = name.split(separator: " ")
  let first = words.first?.first.map(String.init) ?? ""
  let second = words.dropFirst().first?.first.map(String.init) ?? ""
  let result = (first + second).uppercased()
  return result.isEmpty ? "?" : result
}
