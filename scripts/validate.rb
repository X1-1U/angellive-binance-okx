#!/usr/bin/env ruby

require "digest"
require "json"
require "open3"
require "pathname"

ROOT = Pathname.new(__dir__).join("..").expand_path
PLUGINS = %w[binance okx].freeze
ICON_SIZES = {
  "live_card" => [128, 128],
  "mini_live_card" => [30, 30],
  "pad_live_card" => [50, 50],
  "tv_big" => [320, 192],
  "tv_big_dark" => [320, 192],
  "tv_small" => [320, 193],
  "tv_small_dark" => [320, 192]
}.freeze

errors = []

def png_size(path)
  bytes = path.binread(24)
  return nil unless bytes.byteslice(0, 8) == "\x89PNG\r\n\x1a\n".b
  bytes.byteslice(16, 8).unpack("N2")
end

PLUGINS.each do |plugin_id|
  directory = ROOT.join("plugins", plugin_id)
  manifest_path = directory.join("manifest.json")
  begin
    manifest = JSON.parse(manifest_path.read)
  rescue StandardError => error
    errors << "#{manifest_path}: #{error.message}"
    next
  end

  required = %w[pluginId version apiVersion liveTypes entry]
  required.each { |key| errors << "#{manifest_path}: missing #{key}" unless manifest.key?(key) }
  errors << "#{manifest_path}: pluginId mismatch" unless manifest["pluginId"] == plugin_id
  errors << "#{manifest_path}: apiVersion must be 1" unless manifest["apiVersion"] == 1
  errors << "#{manifest_path}: liveTypes must include #{plugin_id}" unless manifest["liveTypes"]&.include?(plugin_id)
  entry = directory.join(manifest["entry"].to_s)
  errors << "#{entry}: missing" unless entry.file?
  if entry.file?
    source = entry.read
    errors << "#{entry}: LiveParsePlugin global missing" unless source.include?("globalThis.LiveParsePlugin")
    errors << "#{entry}: JS apiVersion 1 missing" unless source.match?(/apiVersion\s*:\s*1/)
    %w[getCategories getRooms getPlayback search getRoomDetail getLiveState resolveShare].each do |method|
      errors << "#{entry}: missing #{method}" unless source.match?(/async\s+#{method}\s*\(/)
    end
  end

  ICON_SIZES.each do |kind, expected|
    filename = case kind
               when "live_card", "mini_live_card", "pad_live_card"
                 "#{kind}_#{plugin_id}.png"
               else
                 suffix = kind.sub("tv_", "")
                 "tv_#{plugin_id}_#{suffix}.png"
               end
    path = directory.join("assets", filename)
    unless path.file?
      errors << "#{path}: missing"
      next
    end
    actual = png_size(path)
    errors << "#{path}: expected PNG #{expected.join("x")}, got #{actual&.join("x") || "invalid"}" unless actual == expected
  end
end

source_path = ROOT.join("dist", "source.json")
if source_path.file?
  begin
    source = JSON.parse(source_path.read)
    errors << "#{source_path}: apiVersion must be 1" unless source["apiVersion"] == 1
    errors << "#{source_path}: plugins must contain two items" unless source["plugins"].is_a?(Array) && source["plugins"].size == 2
    Array(source["plugins"]).each do |item|
      plugin_id = item["pluginId"]
      zip_path = ROOT.join("dist", "#{plugin_id}-#{item["version"]}.zip")
      unless zip_path.file?
        errors << "#{zip_path}: missing"
        next
      end
      actual_sha = Digest::SHA256.file(zip_path).hexdigest
      errors << "#{zip_path}: sha256 mismatch" unless actual_sha == item["sha256"]
      listing, status = Open3.capture2("/usr/bin/unzip", "-Z1", zip_path.to_s)
      unless status.success?
        errors << "#{zip_path}: cannot inspect ZIP"
        next
      end
      paths = listing.lines.map(&:strip)
      errors << "#{zip_path}: root manifest.json missing" unless paths.include?("manifest.json")
      errors << "#{zip_path}: root entry index.js missing" unless paths.include?("index.js")
      errors << "#{zip_path}: unsafe path" if paths.any? { |path| path.start_with?("/") || path.split("/").include?("..") }
      manifest_text, manifest_status = Open3.capture2("/usr/bin/unzip", "-p", zip_path.to_s, "manifest.json")
      if manifest_status.success?
        begin
          packaged_manifest = JSON.parse(manifest_text)
          errors << "#{zip_path}: source/manifest pluginId mismatch" unless packaged_manifest["pluginId"] == item["pluginId"]
          errors << "#{zip_path}: source/manifest version mismatch" unless packaged_manifest["version"] == item["version"]
          errors << "#{zip_path}: packaged JS apiVersion mismatch" unless packaged_manifest["apiVersion"] == 1
        rescue JSON::ParserError => error
          errors << "#{zip_path}: invalid packaged manifest (#{error.message})"
        end
      else
        errors << "#{zip_path}: cannot read packaged manifest"
      end
      urls = Array(item["zipURLs"]) + [item["zipURL"]]
      errors << "#{source_path}: #{plugin_id} zip URL must be absolute HTTPS" unless urls.compact.any? { |url| url.start_with?("https://") }
    end
  rescue StandardError => error
    errors << "#{source_path}: #{error.message}"
  end
end

if errors.empty?
  puts "validate: OK (#{PLUGINS.join(", ")})"
  exit 0
end

warn errors.join("\n")
exit 1
