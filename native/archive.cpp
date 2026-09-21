#include "StormLib.h"
#include <filesystem>
#include <fstream>
#include <iostream>
#include <algorithm>
#include <set>
#include <sstream>
#include <stdexcept>
#include <vector>

namespace fs = std::filesystem;
struct Entry { std::string name, local, time; DWORD locale, flags, size; };
struct Archive {
    HANDLE handle = nullptr;
    ~Archive() { if(handle) SFileCloseArchive(handle); }
};
void check(bool ok, const std::string & operation) {
    if(!ok) throw std::runtime_error(operation + " (StormLib error " + std::to_string(SErrGetLastError()) + ")");
}
std::string quote(const std::string & s) {
    std::ostringstream o; o << '"';
    const char * hex = "0123456789abcdef";
    for(unsigned char c : s) {
        if(c == '"' || c == '\\') o << '\\' << c;
        else if(c < 32) o << "\\u00" << hex[c >> 4] << hex[c & 15];
        else o << c;
    }
    o << '"'; return o.str();
}
std::string portable(const std::string & name) {
    std::string result = name;
    std::replace(result.begin(), result.end(), '\\', '/');
    if(result.empty() || result.front() == '/' || result.find(':') != std::string::npos)
        throw std::runtime_error("UNSAFE_ARCHIVE_NAME: " + name);
    std::istringstream stream(result); std::string part;
    while(std::getline(stream, part, '/')) {
        if(part.empty() || part == "." || part == ".." || part.back() == '.' || part.back() == ' ')
            throw std::runtime_error("UNSAFE_ARCHIVE_NAME: " + name);
        for(unsigned char c : part) if(c < 32 || c == 127 || c == '*' || c == '?' || c == '"' || c == '<' || c == '>' || c == '|')
            throw std::runtime_error("UNSAFE_ARCHIVE_NAME: " + name);
        std::string base = part.substr(0, part.find('.'));
        std::transform(base.begin(), base.end(), base.begin(), [](unsigned char c){ return std::toupper(c); });
        if(base == "CON" || base == "PRN" || base == "AUX" || base == "NUL" ||
           (base.size() == 4 && (base.substr(0,3) == "COM" || base.substr(0,3) == "LPT") && base[3] >= '1' && base[3] <= '9'))
            throw std::runtime_error("UNSAFE_ARCHIVE_NAME: " + name);
    }
    return result;
}
bool internal(const std::string & name) {
    return name == LISTFILE_NAME || name == ATTRIBUTES_NAME || name == SIGNATURE_NAME;
}
bool toolFile(const std::string & name) {
    return name.find(".sc2uimcp.") != std::string::npos || name.find(".sc2mcp-") != std::string::npos;
}
std::string folded(std::string value) {
    std::transform(value.begin(), value.end(), value.begin(), [](unsigned char c){ return std::tolower(c); }); return value;
}
std::vector<Entry> enumerate(Archive & archive) {
    std::vector<Entry> entries; SFILE_FIND_DATA data{};
    HANDLE find = SFileFindFirstFile(archive.handle, "*", &data, nullptr);
    if(!find) throw std::runtime_error("ARCHIVE_ENUMERATION_FAILED");
    try {
        do {
            std::string name = data.cFileName;
            // StormLib synthesizes names for unnamed records. Repacking those
            // would change their name hash, so fail rather than silently lose them.
            if(name.size() >= 13 && name.substr(0,4) == "File" && name[12] == '.')
                throw std::runtime_error("INCOMPLETE_ARCHIVE_NAMES: " + name);
            std::string local = portable(name);
            if(!internal(name) && toolFile(local)) throw std::runtime_error("RESERVED_ARCHIVE_ENTRY: " + name);
            if(data.lcLocale != 0) local = ".sc2mcp-locales/" + std::to_string(data.lcLocale) + "/" + local;
            entries.push_back({name, local, std::to_string((uint64_t(data.dwFileTimeHi) << 32) | data.dwFileTimeLo),
                               data.lcLocale, data.dwFileFlags, data.dwFileSize});
            if(entries.size() > 100000) throw std::runtime_error("ARCHIVE_ENTRY_LIMIT");
        } while(SFileFindNextFile(find, &data));
    } catch(...) { SFileFindClose(find); throw; }
    DWORD last = SErrGetLastError(); SFileFindClose(find);
    if(last != ERROR_NO_MORE_FILES && last != ERROR_SUCCESS) throw std::runtime_error("ARCHIVE_ENUMERATION_INTERRUPTED");
    DWORD count = 0;
    check(SFileGetFileInfo(archive.handle, SFileMpqNumberOfFiles, &count, sizeof(count), nullptr), "archive file count");
    if(count != entries.size()) throw std::runtime_error("INCOMPLETE_ARCHIVE_ENUMERATION");
    std::set<std::string> seen;
    uint64_t total = 0;
    for(const auto & e : entries) {
        if(!seen.insert(folded(e.local)).second) throw std::runtime_error("ARCHIVE_NAME_COLLISION");
        total += e.size;
        if(e.size > 512 * 1024 * 1024u || total > uint64_t(4) * 1024 * 1024 * 1024) throw std::runtime_error("ARCHIVE_SIZE_LIMIT");
    }
    return entries;
}
void safeDirectories(const fs::path & root, const std::string & relative) {
    fs::path current = root;
    if(fs::is_symlink(fs::symlink_status(root))) throw std::runtime_error("SYMLINK_ARCHIVE_ROOT");
    for(const auto & part : fs::u8path(relative)) {
        current /= part;
        if(fs::is_symlink(fs::symlink_status(current))) throw std::runtime_error("SYMLINK_ARCHIVE_PATH");
    }
    fs::create_directories((root / fs::u8path(relative)).parent_path());
}
void extractEntry(Archive & archive, const Entry & e, const fs::path & root) {
    safeDirectories(root, e.local);
    const fs::path output = root / fs::u8path(e.local);
    if(fs::exists(output)) throw std::runtime_error("EXTRACT_TARGET_EXISTS");
    SFileSetLocale(e.locale); HANDLE file = nullptr;
    check(SFileOpenFileEx(archive.handle, e.name.c_str(), SFILE_OPEN_FROM_MPQ, &file), "open entry " + e.name);
    try {
        DWORD actualLocale = 0;
        check(SFileGetFileInfo(file, SFileInfoLocale, &actualLocale, sizeof(actualLocale), nullptr), "entry locale");
        if(actualLocale != e.locale) throw std::runtime_error("ARCHIVE_LOCALE_FALLBACK");
        std::ofstream stream(output, std::ios::binary);
        if(!stream) throw std::runtime_error("EXTRACT_WRITE_FAILED");
        char buffer[65536]; uint64_t total = 0;
        while(total < e.size) {
            DWORD requested = DWORD(std::min<uint64_t>(sizeof(buffer), e.size - total)), read = 0;
            check(SFileReadFile(file, buffer, requested, &read, nullptr), "read entry " + e.name);
            if(read != requested) throw std::runtime_error("SHORT_ARCHIVE_READ");
            stream.write(buffer, read); if(!stream) throw std::runtime_error("EXTRACT_WRITE_FAILED"); total += read;
        }
        stream.close(); if(!stream) throw std::runtime_error("EXTRACT_CLOSE_FAILED");
    } catch(...) { SFileCloseFile(file); throw; }
    SFileCloseFile(file);
}
void printManifest(const std::vector<Entry> & entries, uint64_t offset) {
    std::cout << "{\"protocol\":\"sc2-mcp-storm-v1\",\"stormRevision\":\"44ebfbfc109d76e2a85bbd5d8b0c949df7e65c6f\",\"headerOffset\":" << offset << ",\"entries\":[";
    bool first = true;
    for(const auto & e : entries) {
        if(!first) std::cout << ','; first = false;
        std::cout << "{\"name\":" << quote(e.name) << ",\"localPath\":" << quote(e.local)
                  << ",\"locale\":" << e.locale << ",\"flags\":" << e.flags << ",\"size\":" << e.size
                  << ",\"fileTime\":" << quote(e.time) << ",\"internal\":" << (internal(e.name) ? "true" : "false") << '}';
    }
    std::cout << "]}\n";
}
void pack(const fs::path & root, const fs::path & output, const fs::path & plan) {
    if(fs::exists(output)) throw std::runtime_error("PACK_TARGET_EXISTS");
    std::ifstream input(plan); if(!input) throw std::runtime_error("PACK_PLAN_REQUIRED");
    std::vector<Entry> entries; std::string line; std::set<std::string> seen;
    while(std::getline(input, line)) {
        std::istringstream row(line); std::vector<std::string> fields; std::string field;
        while(std::getline(row, field, '\t')) fields.push_back(field);
        if(fields.size() != 5) throw std::runtime_error("INVALID_PACK_PLAN");
        std::string name = portable(fields[0]), local = portable(fields[1]);
        DWORD locale = std::stoul(fields[2]), flags = std::stoul(fields[3]);
        if(internal(name) || toolFile(name)) throw std::runtime_error("RESERVED_PACK_ENTRY");
        if(!seen.insert(folded(name) + ":" + std::to_string(locale)).second) throw std::runtime_error("PACK_NAME_COLLISION");
        safeDirectories(root, local);
        auto size = fs::file_size(root / fs::u8path(local));
        if(size > 512 * 1024 * 1024u) throw std::runtime_error("PACK_ENTRY_LIMIT");
        // Preserve file encryption/CRC intent, rebuild compression and offset keys.
        flags = (flags & (MPQ_FILE_ENCRYPTED | MPQ_FILE_FIX_KEY | MPQ_FILE_SECTOR_CRC)) | MPQ_FILE_COMPRESS;
        entries.push_back({name, local, fields[4], locale, flags, DWORD(size)});
        if(entries.size() > 100000) throw std::runtime_error("PACK_ENTRY_LIMIT");
    }
    Archive archive; SFILE_CREATE_MPQ info{}; info.cbSize = sizeof(info);
    // HET/BET archives cannot represent same-name locale variants in StormLib.
    // Use a classic hash-table profile for those records, retaining locale identity.
    bool localized = std::any_of(entries.begin(),entries.end(),[](const Entry & e){ return e.locale != 0; });
    info.dwMpqVersion = localized ? MPQ_FORMAT_VERSION_2 : MPQ_FORMAT_VERSION_4;
    info.dwStreamFlags = STREAM_PROVIDER_FLAT | BASE_PROVIDER_FILE;
    info.dwFileFlags1 = MPQ_FILE_DEFAULT_INTERNAL; info.dwFileFlags2 = MPQ_FILE_DEFAULT_INTERNAL;
    info.dwAttrFlags = MPQ_ATTRIBUTE_CRC32 | MPQ_ATTRIBUTE_MD5 | MPQ_ATTRIBUTE_FILETIME;
    info.dwSectorSize = 0x4000; info.dwRawChunkSize = localized ? 0 : 0x4000;
    info.dwMaxFileCount = DWORD(entries.size() + 16);
    check(SFileCreateArchive2(output.c_str(), &info, &archive.handle), "create MPQ v4");
    for(const auto & e : entries) {
        std::string name = e.name; std::replace(name.begin(), name.end(), '/', '\\');
        HANDLE file = nullptr;
        check(SFileCreateFile(archive.handle, name.c_str(), std::stoull(e.time), e.size, e.locale, e.flags, &file), "create entry " + name);
        try {
            std::ifstream stream(root / fs::u8path(e.local), std::ios::binary); char buffer[65536]; uint64_t total = 0;
            if(!stream) throw std::runtime_error("PACK_READ_FAILED");
            while(total < e.size) {
                auto n = std::min<uint64_t>(sizeof(buffer), e.size - total);
                stream.read(buffer, n); if(uint64_t(stream.gcount()) != n) throw std::runtime_error("PACK_SHORT_READ");
                check(SFileWriteFile(file, buffer, DWORD(n), MPQ_COMPRESSION_ZLIB), "write entry " + name); total += n;
            }
        } catch(...) { SFileFinishFile(file); throw; }
        check(SFileFinishFile(file), "finish entry " + name);
    }
    check(SFileCloseArchive(archive.handle), "close archive"); archive.handle = nullptr;
    std::cout << "{\"packed\":true,\"mpqFormatField\":" << info.dwMpqVersion << "}\n";
}
int run(const std::vector<std::string> & args) {
    try {
        if(args.size() < 3) throw std::runtime_error("Usage: inspect <archive> | extract <archive> <dir> | pack <dir> <archive> <plan.tsv>");
        const std::string & op = args[1]; const fs::path source = fs::u8path(args[2]);
        if(op == "pack" && args.size() == 5) { pack(source, fs::u8path(args[3]), fs::u8path(args[4])); return 0; }
        if(op != "inspect" && op != "extract") throw std::runtime_error("INVALID_OPERATION");
        if(op == "extract" && args.size() != 4) throw std::runtime_error("EXTRACT_DESTINATION_REQUIRED");
        Archive archive;
        check(SFileOpenArchive(source.c_str(), 0, MPQ_OPEN_READ_ONLY | MPQ_OPEN_CHECK_SECTOR_CRC, &archive.handle), "open archive");
        ULONGLONG offset = 0;
        check(SFileGetFileInfo(archive.handle, SFileMpqHeaderOffset, &offset, sizeof(offset), nullptr), "header offset");
        auto entries = enumerate(archive);
        if(op == "extract") {
            if(offset != 0) throw std::runtime_error("ARCHIVE_PREFIX_PRESERVATION_UNAVAILABLE");
            const fs::path root = fs::u8path(args[3]); fs::create_directories(root);
            for(const auto & e : entries) if(!internal(e.name)) extractEntry(archive, e, root);
        }
        printManifest(entries, offset); return 0;
    } catch(const std::exception & e) { std::cerr << "{\"error\":" << quote(e.what()) << "}\n"; return 1; }
}
#ifdef _WIN32
int wmain(int argc, wchar_t ** argv) {
    std::vector<std::string> args;
    for(int i = 0; i < argc; ++i) {
        int size = WideCharToMultiByte(CP_UTF8, 0, argv[i], -1, nullptr, 0, nullptr, nullptr);
        std::string text(size, '\0'); WideCharToMultiByte(CP_UTF8, 0, argv[i], -1, text.data(), size, nullptr, nullptr);
        text.pop_back(); args.push_back(text);
    }
    return run(args);
}
#else
int main(int argc, char ** argv) { return run(std::vector<std::string>(argv, argv + argc)); }
#endif
