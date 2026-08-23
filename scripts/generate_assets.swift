#!/usr/bin/env swift

import AppKit
import Foundation

let arguments = CommandLine.arguments
guard arguments.count == 2 else {
    fputs("usage: generate_assets.swift ROOT\n", stderr)
    exit(2)
}

let root = URL(fileURLWithPath: arguments[1], isDirectory: true)

func color(_ hex: UInt32, alpha: CGFloat = 1) -> NSColor {
    NSColor(
        calibratedRed: CGFloat((hex >> 16) & 0xff) / 255,
        green: CGFloat((hex >> 8) & 0xff) / 255,
        blue: CGFloat(hex & 0xff) / 255,
        alpha: alpha
    )
}

func fillRounded(_ rect: NSRect, radius: CGFloat, color fill: NSColor) {
    fill.setFill()
    NSBezierPath(roundedRect: rect, xRadius: radius, yRadius: radius).fill()
}

func fillPolygon(_ points: [NSPoint], color fill: NSColor) {
    guard let first = points.first else { return }
    let path = NSBezierPath()
    path.move(to: first)
    for point in points.dropFirst() { path.line(to: point) }
    path.close()
    fill.setFill()
    path.fill()
}

func diamond(centerX: CGFloat, centerY: CGFloat, half: CGFloat, color fill: NSColor) {
    fillPolygon([
        NSPoint(x: centerX, y: centerY + half),
        NSPoint(x: centerX + half, y: centerY),
        NSPoint(x: centerX, y: centerY - half),
        NSPoint(x: centerX - half, y: centerY)
    ], color: fill)
}

func drawBinanceMark(centerX: CGFloat, centerY: CGFloat, scale: CGFloat, color fill: NSColor) {
    let gap = 28 * scale
    let outerHalf = 16 * scale
    diamond(centerX: centerX, centerY: centerY + gap, half: outerHalf, color: fill)
    diamond(centerX: centerX - gap, centerY: centerY, half: outerHalf, color: fill)
    diamond(centerX: centerX + gap, centerY: centerY, half: outerHalf, color: fill)
    diamond(centerX: centerX, centerY: centerY - gap, half: outerHalf, color: fill)
    diamond(centerX: centerX, centerY: centerY, half: 18 * scale, color: fill)
}

func drawOKXMark(originX: CGFloat, originY: CGFloat, scale: CGFloat, color fill: NSColor) {
    let cells: [(CGFloat, CGFloat, CGFloat, CGFloat)] = [
        (0, 24, 18, 18), (0, 0, 18, 18),
        (24, 24, 18, 18), (24, 0, 18, 18),
        (48, 24, 18, 18), (72, 24, 16, 18),
        (60, 12, 16, 18), (48, 0, 18, 18), (72, 0, 16, 18)
    ]
    fill.setFill()
    for cell in cells {
        NSBezierPath(rect: NSRect(
            x: originX + cell.0 * scale,
            y: originY + cell.1 * scale,
            width: cell.2 * scale,
            height: cell.3 * scale
        )).fill()
    }
}

func drawLabel(_ text: String, x: CGFloat, y: CGFloat, size: CGFloat, color fill: NSColor, weight: NSFont.Weight, spacing: CGFloat = 0) {
    let attributes: [NSAttributedString.Key: Any] = [
        .font: NSFont.systemFont(ofSize: size, weight: weight),
        .foregroundColor: fill,
        .kern: spacing
    ]
    (text as NSString).draw(at: NSPoint(x: x, y: y), withAttributes: attributes)
}

func render(width: Int, height: Int, output: URL, drawing: () -> Void) throws {
    guard let bitmap = NSBitmapImageRep(
        bitmapDataPlanes: nil,
        pixelsWide: width,
        pixelsHigh: height,
        bitsPerSample: 8,
        samplesPerPixel: 4,
        hasAlpha: true,
        isPlanar: false,
        colorSpaceName: .deviceRGB,
        bytesPerRow: 0,
        bitsPerPixel: 0
    ) else { throw NSError(domain: "AngelLiveAssets", code: 1) }
    bitmap.size = NSSize(width: width, height: height)
    guard let context = NSGraphicsContext(bitmapImageRep: bitmap) else {
        throw NSError(domain: "AngelLiveAssets", code: 2)
    }
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = context
    NSColor.clear.setFill()
    NSBezierPath(rect: NSRect(x: 0, y: 0, width: width, height: height)).fill()
    drawing()
    context.flushGraphics()
    NSGraphicsContext.restoreGraphicsState()
    guard let png = bitmap.representation(using: .png, properties: [:]) else {
        throw NSError(domain: "AngelLiveAssets", code: 3)
    }
    try png.write(to: output, options: .atomic)
}

func square(plugin: String, size: Int) throws {
    let prefix = size == 128 ? "live_card" : size == 50 ? "pad_live_card" : "mini_live_card"
    let output = root.appendingPathComponent("plugins/\(plugin)/assets/\(prefix)_\(plugin).png")
    try render(width: size, height: size, output: output) {
        let side = CGFloat(size)
        let scale = side / 128
        let background = plugin == "binance" ? color(0xF0B90B) : color(0x111111)
        let foreground = plugin == "binance" ? color(0x101010) : color(0xFFFFFF)
        fillRounded(NSRect(x: 0, y: 0, width: side, height: side), radius: 26 * scale, color: background)
        if plugin == "binance" {
            drawBinanceMark(centerX: side / 2, centerY: side / 2, scale: scale, color: foreground)
        } else {
            drawOKXMark(originX: 20 * scale, originY: 43 * scale, scale: scale, color: foreground)
        }
    }
}

func television(plugin: String, width: Int, height: Int, dark: Bool, suffix: String) throws {
    let output = root.appendingPathComponent("plugins/\(plugin)/assets/tv_\(plugin)_\(suffix).png")
    try render(width: width, height: height, output: output) {
        let w = CGFloat(width)
        let h = CGFloat(height)
        if plugin == "binance" {
            let background = dark ? color(0x151515) : color(0xF0B90B)
            let primary = dark ? color(0xF8F8F8) : color(0x101010)
            let accent = color(0xF0B90B)
            fillRounded(NSRect(x: 0, y: 0, width: w, height: h), radius: 28, color: background)
            if dark {
                color(0xF0B90B).setFill()
                NSBezierPath(ovalIn: NSRect(x: 23, y: h / 2 - 53, width: 106, height: 106)).fill()
                drawBinanceMark(centerX: 76, centerY: h / 2, scale: 0.56, color: color(0x101010))
            } else {
                drawBinanceMark(centerX: 82, centerY: h / 2, scale: 0.75, color: color(0x101010))
            }
            drawLabel("BINANCE", x: dark ? 137 : 146, y: h / 2 + 7, size: 26, color: primary, weight: .bold)
            drawLabel("SQUARE LIVE", x: dark ? 137 : 146, y: h / 2 - 21, size: 17, color: dark ? accent : primary, weight: .semibold, spacing: 2)
        } else {
            let background = dark ? color(0x111111) : color(0xF4F4F4)
            let primary = dark ? color(0xFFFFFF) : color(0x111111)
            fillRounded(NSRect(x: 0, y: 0, width: w, height: h), radius: 28, color: background)
            fillRounded(NSRect(x: 27, y: h / 2 - 53, width: 106, height: 106), radius: 22, color: primary)
            drawOKXMark(originX: 40, originY: h / 2 - 15, scale: 0.72, color: background)
            drawLabel("OKX", x: 153, y: h / 2 + 7, size: 29, color: primary, weight: .heavy)
            drawLabel("ORBIT LIVE", x: 153, y: h / 2 - 21, size: 17, color: dark ? color(0xCFCFCF) : primary, weight: .semibold, spacing: 2)
        }
    }
}

do {
    for plugin in ["binance", "okx"] {
        try square(plugin: plugin, size: 128)
        try square(plugin: plugin, size: 50)
        try square(plugin: plugin, size: 30)
        try television(plugin: plugin, width: 320, height: 192, dark: false, suffix: "big")
        try television(plugin: plugin, width: 320, height: 192, dark: true, suffix: "big_dark")
        try television(plugin: plugin, width: 320, height: 193, dark: false, suffix: "small")
        try television(plugin: plugin, width: 320, height: 192, dark: true, suffix: "small_dark")
    }
    print("assets: generated")
} catch {
    fputs("assets: \(error)\n", stderr)
    exit(1)
}
