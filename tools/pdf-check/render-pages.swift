import AppKit
import Foundation
import PDFKit

// 用法：swift tools/pdf-check/render-pages.swift <pdf> <out-dir>

let args = CommandLine.arguments
guard args.count >= 3 else { fatalError("usage: render-pages <pdf> <out-dir>") }
let pdfURL = URL(fileURLWithPath: args[1])
let outDir = URL(fileURLWithPath: args[2], isDirectory: true)
try FileManager.default.createDirectory(at: outDir, withIntermediateDirectories: true)
guard let doc = PDFDocument(url: pdfURL) else { fatalError("cannot open PDF") }
print("pages: \(doc.pageCount)")

for index in 0..<doc.pageCount {
    guard let page = doc.page(at: index) else { continue }
    let bounds = page.bounds(for: .mediaBox)
    let scale: CGFloat = 1.3
    let size = NSSize(width: bounds.width * scale, height: bounds.height * scale)
    let image = NSImage(size: size)
    image.lockFocus()
    NSColor.white.setFill()
    NSRect(origin: .zero, size: size).fill()
    if let ctx = NSGraphicsContext.current?.cgContext {
        ctx.saveGState()
        ctx.scaleBy(x: scale, y: scale)
        page.draw(with: .mediaBox, to: ctx)
        ctx.restoreGState()
    }
    image.unlockFocus()
    if let tiff = image.tiffRepresentation,
       let rep = NSBitmapImageRep(data: tiff),
       let png = rep.representation(using: .png, properties: [:])
    {
        try png.write(
            to: outDir.appendingPathComponent(String(format: "page-%02d.png", index + 1))
        )
    }
}
