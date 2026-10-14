import AppKit
import ApplicationServices
import Carbon

// A persistent helper keeps AX references in this process, never in the renderer.
// Only metadata and the selection range are inspected; existing text is not read.
struct Target {
  let token: String
  let app: NSRunningApplication
  let element: AXUIElement
  let selection: CFRange
}

let ownerPID = pid_t(CommandLine.arguments.dropFirst().first ?? "") ?? getppid()
var previousApp: NSRunningApplication?
var target: Target?
var inserting = false

func attribute(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
  var value: CFTypeRef?
  guard AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success else { return nil }
  return value
}

func focused(_ app: NSRunningApplication) -> AXUIElement? {
  guard let value = attribute(AXUIElementCreateApplication(app.processIdentifier), kAXFocusedUIElementAttribute),
    CFGetTypeID(value) == AXUIElementGetTypeID() else { return nil }
  return (value as! AXUIElement)
}

func selection(_ element: AXUIElement) -> CFRange? {
  guard let value = attribute(element, kAXSelectedTextRangeAttribute), CFGetTypeID(value) == AXValueGetTypeID() else { return nil }
  var range = CFRange()
  guard AXValueGetValue(value as! AXValue, .cfRange, &range) else { return nil }
  return range
}

func editable(_ element: AXUIElement) -> Bool {
  let role = attribute(element, kAXRoleAttribute) as? String
  let subrole = attribute(element, kAXSubroleAttribute) as? String
  guard subrole != kAXSecureTextFieldSubrole,
    [kAXTextFieldRole, kAXTextAreaRole, kAXComboBoxRole].contains(role ?? "") else { return false }
  if let enabled = attribute(element, kAXEnabledAttribute) as? Bool, !enabled { return false }
  var settable = DarwinBoolean(false)
  for name in [kAXSelectedTextAttribute, kAXValueAttribute] {
    if AXUIElementIsAttributeSettable(element, name as CFString, &settable) == .success && settable.boolValue { return true }
  }
  return false
}

func reply(_ id: Int, _ fields: [String: Any]) {
  var result = fields
  result["id"] = id
  guard let data = try? JSONSerialization.data(withJSONObject: result, options: [.sortedKeys]) else { return }
  FileHandle.standardOutput.write(data)
  FileHandle.standardOutput.write(Data([10]))
}

func destinationValid(_ saved: Target) -> Bool {
  guard AXIsProcessTrusted(), !saved.app.isTerminated,
    NSWorkspace.shared.frontmostApplication?.processIdentifier == saved.app.processIdentifier,
    let current = focused(saved.app), CFEqual(current, saved.element), editable(current),
    let range = selection(current) else { return false }
  // A moved caret or changed selection must not receive a delayed paste.
  return range.location == saved.selection.location && range.length == saved.selection.length
}

func pasteKey() -> CGKeyCode? {
  let source = TISCopyCurrentKeyboardLayoutInputSource().takeRetainedValue()
  guard let property = TISGetInputSourceProperty(source, kTISPropertyUnicodeKeyLayoutData) else { return nil }
  let data = Unmanaged<CFData>.fromOpaque(property).takeUnretainedValue()
  let layout = UnsafeRawPointer(CFDataGetBytePtr(data)).assumingMemoryBound(to: UCKeyboardLayout.self)
  // Resolve Command+V in the current layout, including layouts that switch under Command.
  for key in UInt16(0)..<128 {
    var dead: UInt32 = 0
    var count = 0
    var characters = [UniChar](repeating: 0, count: 4)
    let status = UCKeyTranslate(layout, key, UInt16(kUCKeyActionDown), UInt32(cmdKey >> 8), UInt32(LMGetKbdType()), OptionBits(kUCKeyTranslateNoDeadKeysBit), &dead, 4, &count, &characters)
    if status == noErr && count == 1 && (characters[0] == 118 || characters[0] == 86) { return key }
  }
  return nil
}

func paste(_ id: Int, _ saved: Target, _ text: String, _ attempts: Int = 0) {
  guard attempts < 20 else {
    inserting = false
    reply(id, ["ok": false, "reason": "destination"])
    return
  }
  if NSWorkspace.shared.frontmostApplication?.processIdentifier != saved.app.processIdentifier {
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) { paste(id, saved, text, attempts + 1) }
    return
  }
  guard destinationValid(saved) else {
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) { paste(id, saved, text, attempts + 1) }
    return
  }
  guard !IsSecureEventInputEnabled(),
    CGEventSource.flagsState(.combinedSessionState).intersection([.maskCommand, .maskControl, .maskAlternate, .maskShift]).isEmpty else {
    inserting = false
    reply(id, ["ok": false, "reason": "keyboard"])
    return
  }
  guard let key = pasteKey(),
    let down = CGEvent(keyboardEventSource: nil, virtualKey: key, keyDown: true),
    let up = CGEvent(keyboardEventSource: nil, virtualKey: key, keyDown: false) else {
    inserting = false
    reply(id, ["ok": false, "reason": "layout"])
    return
  }
  // Deliberately leave the transcript on the clipboard, including on uncertain delivery.
  // Restoring a clipboard on a timer can overwrite a new copy or race a slow target.
  NSPasteboard.general.clearContents()
  guard NSPasteboard.general.setString(text, forType: .string) else {
    inserting = false
    reply(id, ["ok": false, "reason": "clipboard"])
    return
  }
  down.flags = .maskCommand
  up.flags = .maskCommand
  down.post(tap: .cghidEventTap)
  up.post(tap: .cghidEventTap)
  target = nil
  inserting = false
  // This confirms dispatch, not delivery. No automatic retry can duplicate a paste.
  reply(id, ["ok": true])
}

func handle(_ message: [String: Any]) {
  guard let id = message["id"] as? Int, let command = message["command"] as? String else { return }
  if command == "status" {
    reply(id, ["ok": true, "trusted": AXIsProcessTrusted()])
  } else if command == "capture" {
    target = nil
    let front = NSWorkspace.shared.frontmostApplication
    let app = front?.processIdentifier == ownerPID ? previousApp : front
    let name = app?.localizedName ?? ""
    guard AXIsProcessTrusted() else {
      reply(id, ["ok": false, "name": name, "reason": "permission"])
      return
    }
    guard let app, app.processIdentifier != ownerPID, !app.isTerminated,
      let element = focused(app), editable(element), let range = selection(element) else {
      reply(id, ["ok": false, "name": name, "reason": "destination"])
      return
    }
    let saved = Target(token: UUID().uuidString, app: app, element: element, selection: range)
    target = saved
    reply(id, ["ok": true, "name": name, "token": saved.token])
  } else if command == "insert" {
    guard !inserting, let saved = target, message["token"] as? String == saved.token,
      let text = message["text"] as? String, !text.isEmpty, text.utf8.count <= 200_000,
      AXIsProcessTrusted(), !saved.app.isTerminated else {
      reply(id, ["ok": false, "reason": "destination"])
      return
    }
    // Automatic completion must not drag the user back after they switched apps.
    let frontPID = NSWorkspace.shared.frontmostApplication?.processIdentifier
    if message["automatic"] as? String == "true" && frontPID != saved.app.processIdentifier && frontPID != ownerPID {
      reply(id, ["ok": false, "reason": "destination"])
      return
    }
    inserting = true
    saved.app.activate(options: [])
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { paste(id, saved, text) }
  } else {
    reply(id, ["ok": false, "reason": "command"])
  }
}

let app = NSApplication.shared
app.setActivationPolicy(.prohibited)
if let front = NSWorkspace.shared.frontmostApplication, front.processIdentifier != ownerPID { previousApp = front }
let observer = NSWorkspace.shared.notificationCenter.addObserver(forName: NSWorkspace.didActivateApplicationNotification, object: nil, queue: .main) { notification in
  if let front = notification.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication,
    front.processIdentifier != ownerPID, front.processIdentifier != getpid() { previousApp = front }
}
DispatchQueue.global(qos: .userInitiated).async {
  while let line = readLine() {
    guard line.utf8.count <= 1_000_000, let data = line.data(using: .utf8),
      let message = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { continue }
    DispatchQueue.main.async { handle(message) }
  }
  DispatchQueue.main.async { app.terminate(nil) }
}
app.run()
