#include <CascLib.h>
#include <algorithm>
#include <cctype>
#include <iomanip>
#include <iostream>
#include <map>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>
#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#endif

struct Entry { std::string path, ckey, ekey; ULONGLONG size; bool local; DWORD locale; int nameType; };
static std::string normalized(std::string value) {
    std::replace(value.begin(), value.end(), '\\', '/');
    for (char &ch : value) ch = static_cast<char>(std::tolower(static_cast<unsigned char>(ch)));
    return value;
}
static std::string quote(const std::string &value) {
    std::ostringstream out; out << '"';
    for (unsigned char ch : value) {
        if (ch == '"' || ch == '\\') out << '\\' << ch;
        else if (ch < 32) out << "\\u" << std::hex << std::setw(4) << std::setfill('0') << static_cast<int>(ch) << std::dec;
        else out << ch;
    }
    out << '"'; return out.str();
}
static std::string hex(const BYTE *bytes) {
    const char *table = "0123456789abcdef"; std::string out;
    for (int i = 0; i < 16; i++) { out += table[bytes[i] >> 4]; out += table[bytes[i] & 15]; } return out;
}
static std::string base64(const std::vector<BYTE> &bytes) {
    const char *table = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"; std::string out;
    out.reserve((bytes.size() + 2) / 3 * 4);
    for (size_t i = 0; i < bytes.size(); i += 3) {
        unsigned value = static_cast<unsigned>(bytes[i]) << 16;
        if (i + 1 < bytes.size()) value |= static_cast<unsigned>(bytes[i + 1]) << 8;
        if (i + 2 < bytes.size()) value |= bytes[i + 2];
        out += table[(value >> 18) & 63]; out += table[(value >> 12) & 63];
        out += i + 1 < bytes.size() ? table[(value >> 6) & 63] : '=';
        out += i + 2 < bytes.size() ? table[value & 63] : '=';
    } return out;
}
static bool WINAPI forbidDownload(void *, CASC_PROGRESS_MSG message, LPCSTR, DWORD, DWORD) {
    return message == CascProgressDownloadingFile || message == CascProgressDownloadingArchiveIndexes;
}
static std::string entryJson(const Entry &entry) {
    std::ostringstream out; out << "{\"path\":" << quote(entry.path) << ",\"size\":" << entry.size
        << ",\"local\":" << (entry.local ? "true" : "false") << ",\"contentKey\":" << quote(entry.ckey)
        << ",\"encodingKey\":" << quote(entry.ekey) << ",\"localeFlags\":" << entry.locale << ",\"nameType\":" << entry.nameType << "}"; return out.str();
}
static std::vector<std::string> split(const std::string &line) {
    std::vector<std::string> parts; size_t start = 0;
    for (size_t i = 0; i <= line.size(); i++) if (i == line.size() || line[i] == '\t') { parts.push_back(line.substr(start, i - start)); start = i + 1; }
    return parts;
}
#ifdef _WIN32
int wmain(int argc, wchar_t **argv) {
    _setmode(_fileno(stdin), _O_BINARY); _setmode(_fileno(stdout), _O_BINARY);
#else
int main(int argc, char **argv) {
#endif
    if (argc != 2) { std::cerr << "CASC_USAGE: sc2-mcp-casc <local-install>\n"; return 2; }
    HANDLE storage = NULL; CASC_OPEN_STORAGE_ARGS args = {}; args.Size = sizeof(args);
    args.szLocalPath = argv[1]; args.dwLocaleMask = CASC_LOCALE_ALL; args.PfnProgressCallback = forbidDownload;
    if (!CascOpenStorageEx(NULL, &args, false, &storage)) { std::cerr << "CASC_OPEN_FAILED:" << GetCascError() << "\n"; return 3; }
    DWORD features = 0, localCount = 0, totalCount = 0; CASC_STORAGE_PRODUCT product = {};
    CascGetStorageInfo(storage, CascStorageFeatures, &features, sizeof(features), NULL);
    const bool localCountKnown = CascGetStorageInfo(storage, CascStorageLocalFileCount, &localCount, sizeof(localCount), NULL);
    CascGetStorageInfo(storage, CascStorageTotalFileCount, &totalCount, sizeof(totalCount), NULL);
    CascGetStorageInfo(storage, CascStorageProduct, &product, sizeof(product), NULL);
    if (features & (CASC_FEATURE_ONLINE | CASC_FEATURE_ALLOW_DOWNLOAD)) { CascCloseStorage(storage); std::cerr << "CASC_ONLINE_MODE_REFUSED\n"; return 4; }
    std::map<std::string, Entry> entries; CASC_FIND_DATA found = {}; HANDLE find = CascFindFirstFile(storage, "*", &found, NULL);
    if (find != INVALID_HANDLE_VALUE) {
        do {
            const auto path = normalized(found.szFileName);
            entries.emplace(path, Entry{path, hex(found.CKey), hex(found.EKey), found.FileSize, found.bFileAvailable != 0, found.dwLocaleFlags, static_cast<int>(found.NameType)});
            if (entries.size() > 1000000) { CascFindClose(find); CascCloseStorage(storage); std::cerr << "CASC_INDEX_BUDGET\n"; return 5; }
        } while (CascFindNextFile(find, &found));
        CascFindClose(find);
    } else if (GetCascError() != ERROR_NO_MORE_FILES) { CascCloseStorage(storage); std::cerr << "CASC_INDEX_FAILED\n"; return 6; }
    const auto indexedLocal = std::count_if(entries.begin(), entries.end(), [](const auto &item) { return item.second.local; });
    std::string line;
    while (std::getline(std::cin, line)) {
        if (!line.empty() && line.back() == '\r') line.pop_back();
        unsigned long long id = 0;
        try {
            if (line.size() > 8192) throw std::runtime_error("CASC_REQUEST_BUDGET");
            const auto parts = split(line); if (parts.size() < 2) throw std::runtime_error("CASC_BAD_REQUEST"); id = std::stoull(parts[0]);
            std::ostringstream result;
            if (parts[1] == "info" && parts.size() == 2) {
                result << "{\"protocol\":\"sc2-casc-local-v1\",\"offline\":true,\"product\":" << quote(product.szCodeName)
                    << ",\"buildNumber\":" << product.BuildNumber << ",\"libraryReportedLocalFileCount\":" << (localCountKnown ? std::to_string(localCount) : "null") << ",\"indexedLocalPaths\":" << indexedLocal
                    << ",\"totalFileCount\":" << totalCount << ",\"indexedPaths\":" << entries.size() << "}";
            } else if (parts[1] == "list" && parts.size() == 6) {
                auto prefix = normalized(parts[2]), query = normalized(parts[3]);
                if (!prefix.empty() && prefix.back() != '/') prefix += '/';
                size_t offset = std::stoull(parts[4]), limit = std::stoull(parts[5]), total = 0, emitted = 0;
                if (limit > 100) throw std::runtime_error("CASC_PAGE_BUDGET"); result << "{\"items\":[";
                for (auto it = prefix.empty() ? entries.begin() : entries.lower_bound(prefix); it != entries.end(); ++it) {
                    if (!prefix.empty() && it->first.compare(0, prefix.size(), prefix) != 0) break;
                    if (it->first.find(query) == std::string::npos) continue;
                    if (total >= offset && emitted < limit) { if (emitted++) result << ','; result << entryJson(it->second); } total++;
                }
                result << "],\"total\":" << total << ",\"nextOffset\":";
                if (offset + emitted < total) result << offset + emitted; else result << "null"; result << "}";
            } else if ((parts[1] == "inspect" && parts.size() == 3) || (parts[1] == "read" && parts.size() == 5)) {
                const auto requested = normalized(parts[2]); const auto item = entries.find(requested);
                if (item == entries.end()) throw std::runtime_error("CASC_PATH_NOT_FOUND");
                if (parts[1] == "inspect") result << entryJson(item->second);
                else {
                    HANDLE file = NULL;
                    if (!CascOpenFile(storage, requested.c_str(), CASC_LOCALE_ALL, CASC_OPEN_BY_NAME | CASC_STRICT_DATA_CHECK, &file)) throw std::runtime_error("CASC_FILE_NOT_LOCAL_OR_OPEN_FAILED:" + std::to_string(GetCascError()));
                    try {
                        ULONGLONG size = 0; if (!CascGetFileSize64(file, &size)) throw std::runtime_error("CASC_FILE_SIZE_FAILED");
                        const ULONGLONG offset = std::stoull(parts[3]), length = std::stoull(parts[4]);
                        if (length > 16 * 1024 * 1024 || offset > size || length > size - offset) throw std::runtime_error("CASC_READ_RANGE_BUDGET");
                        CASC_FILE_FULL_INFO info = {}; if (!CascGetFileInfo(file, CascFileFullInfo, &info, sizeof(info), NULL)) throw std::runtime_error("CASC_FILE_INFO_FAILED");
                        if (!CascSetFilePointer64(file, offset, NULL, FILE_BEGIN)) throw std::runtime_error("CASC_SEEK_FAILED");
                        std::vector<BYTE> bytes(static_cast<size_t>(length)); DWORD read = 0;
                        if (length && (!CascReadFile(file, bytes.data(), static_cast<DWORD>(length), &read) || read != length)) throw std::runtime_error("CASC_READ_FAILED:" + std::to_string(GetCascError()));
                        result << "{\"path\":" << quote(requested) << ",\"size\":" << size << ",\"offset\":" << offset
                            << ",\"contentKey\":" << quote(hex(info.CKey)) << ",\"encodingKey\":" << quote(hex(info.EKey)) << ",\"base64\":" << quote(base64(bytes)) << "}";
                        CascCloseFile(file);
                    } catch (...) { CascCloseFile(file); throw; }
                }
            } else throw std::runtime_error("CASC_UNKNOWN_OPERATION");
            std::cout << "{\"id\":" << id << ",\"result\":" << result.str() << "}\n" << std::flush;
        } catch (const std::exception &error) { std::cout << "{\"id\":" << id << ",\"error\":" << quote(error.what()) << "}\n" << std::flush; }
    }
    CascCloseStorage(storage); return 0;
}
