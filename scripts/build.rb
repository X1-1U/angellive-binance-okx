#!/usr/bin/env ruby

require "cgi"
require "digest"
require "fileutils"
require "json"
require "pathname"
require "tmpdir"
require "time"

ROOT = Pathname.new(__dir__).join("..").expand_path
PLUGINS = %w[binance okx].freeze
DIST = ROOT.join("dist")
ASSET_NAMES = lambda do |plugin_id|
  [
    "live_card_#{plugin_id}.png",
    "mini_live_card_#{plugin_id}.png",
    "pad_live_card_#{plugin_id}.png",
    "tv_#{plugin_id}_big.png",
    "tv_#{plugin_id}_big_dark.png",
    "tv_#{plugin_id}_small.png",
    "tv_#{plugin_id}_small_dark.png"
  ]
end

def fail_build(message)
  warn "build: #{message}"
  exit 1
end

def load_manifest(plugin_id)
  path = ROOT.join("plugins", plugin_id, "manifest.json")
  fail_build("missing #{path}") unless path.file?
  JSON.parse(path.read)
rescue JSON::ParserError => error
  fail_build("invalid #{path}: #{error.message}")
end

def deterministic_zip(plugin_id, version)
  source_dir = ROOT.join("plugins", plugin_id)
  output = DIST.join("#{plugin_id}-#{version}.zip")
  FileUtils.rm_f(output)

  Dir.mktmpdir("angellive-#{plugin_id}-") do |temporary|
    stage = Pathname.new(temporary)
    FileUtils.cp_r(Dir.glob(source_dir.join("*").to_s), stage.to_s)
    timestamp = Time.utc(2020, 1, 1, 0, 0, 0)
    Dir.glob(stage.join("**", "*").to_s, File::FNM_DOTMATCH).each do |path|
      next if [".", ".."].include?(File.basename(path))
      File.utime(timestamp, timestamp, path)
    end
    files = Dir.chdir(stage) { Dir.glob("**/*", File::FNM_DOTMATCH).select { |path| File.file?(path) }.sort }
    fail_build("#{plugin_id} package is empty") if files.empty?
    ok = Dir.chdir(stage) { system("/usr/bin/zip", "-X", "-q", output.to_s, *files) }
    fail_build("zip failed for #{plugin_id}") unless ok
  end
  output
end

FileUtils.mkdir_p(DIST)
base_url = ENV.fetch("BASE_URL", "https://YOUR-HOST.example/angellive").sub(%r{/+$}, "")
source_url = ENV.fetch("SOURCE_URL", "#{base_url}/source.json")
unless base_url.start_with?("https://") && source_url.start_with?("https://")
  fail_build("BASE_URL and SOURCE_URL must use HTTPS")
end

items = PLUGINS.map do |plugin_id|
  manifest = load_manifest(plugin_id)
  fail_build("manifest pluginId mismatch for #{plugin_id}") unless manifest["pluginId"] == plugin_id
  fail_build("manifest apiVersion must be 1 for #{plugin_id}") unless manifest["apiVersion"] == 1
  fail_build("manifest liveTypes must include #{plugin_id}") unless manifest["liveTypes"]&.include?(plugin_id)
  fail_build("missing entry for #{plugin_id}") unless ROOT.join("plugins", plugin_id, manifest["entry"].to_s).file?
  ASSET_NAMES.call(plugin_id).each do |asset|
    fail_build("missing plugins/#{plugin_id}/assets/#{asset}") unless ROOT.join("plugins", plugin_id, "assets", asset).file?
  end

  zip = deterministic_zip(plugin_id, manifest.fetch("version"))
  sha = Digest::SHA256.file(zip).hexdigest
  zip_url = "#{base_url}/#{zip.basename}"
  icon = "assets/live_card_#{plugin_id}.png"
  {
    "pluginId" => plugin_id,
    "version" => manifest.fetch("version"),
    "platform" => plugin_id,
    "platformName" => manifest.fetch("displayName"),
    "platformDescription" => manifest.fetch("platformDescription"),
    "zipURLs" => [zip_url],
    "zipURL" => zip_url,
    "sha256" => sha,
    "changelog" => manifest.fetch("changelog", []),
    "auth" => manifest.fetch("auth", {}),
    "capabilities" => manifest.fetch("capabilities", {}),
    "icon" => icon,
    "iosIcon" => icon,
    "macosIcon" => icon,
    "tvosIcon" => icon,
    "visibility" => "public"
  }
end

source = {
  "apiVersion" => 1,
  "generatedAt" => Time.now.utc.iso8601,
  "sourceName" => "Binance + OKX Live for AngelLive",
  "plugins" => items
}
DIST.join("source.json").write(JSON.pretty_generate(source) + "\n")
encoded_source = CGI.escape(source_url).gsub("+", "%20")
DIST.join("install-link.txt").write("angellive://install-source?source=#{encoded_source}\n")

items.each do |item|
  plugin_id = item.fetch("pluginId")
  individual_source = source.merge(
    "sourceName" => "#{item.fetch("platformName")} for AngelLive",
    "plugins" => [item]
  )
  individual_name = "source-#{plugin_id}.json"
  DIST.join(individual_name).write(JSON.pretty_generate(individual_source) + "\n")
  individual_url = "#{base_url}/#{individual_name}"
  encoded_individual_url = CGI.escape(individual_url).gsub("+", "%20")
  DIST.join("install-#{plugin_id}.txt").write(
    "angellive://install-source?source=#{encoded_individual_url}\n"
  )
end
DIST.join("SHA256SUMS").write(
  items.map do |item|
    "#{item.fetch("sha256")}  #{item.fetch("pluginId")}-#{item.fetch("version")}.zip"
  end.join("\n") + "\n"
)

items.each do |item|
  puts "#{item.fetch("pluginId")}: #{item.fetch("sha256")}"
end
puts "source: #{DIST.join("source.json")}"
puts "install: #{DIST.join("install-link.txt")}"
warn "build: replace YOUR-HOST.example or rebuild with BASE_URL/SOURCE_URL before installing" if base_url.include?("YOUR-HOST.example")
