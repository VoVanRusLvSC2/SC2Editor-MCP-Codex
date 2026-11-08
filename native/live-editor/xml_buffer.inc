// Shared bounded UTF-8 transport for original native XML editors.
constexpr size_t kLiveXmlLimit=1024*1024;
static bool LiveXmlText(HWND edit,std::string &bytes,std::wstring &text) {
  LRESULT length=SendMessageW(edit,2006,0,0);
  if(length<=0||length>kLiveXmlLimit)return false;
  std::vector<char> buffer(size_t(length)+1);
  if(SendMessageW(edit,2182,buffer.size(),reinterpret_cast<LPARAM>(buffer.data()))!=length)return false;
  int size=MultiByteToWideChar(CP_UTF8,MB_ERR_INVALID_CHARS,buffer.data(),int(length),nullptr,0);
  if(size<=0)return false;
  text.resize(size);MultiByteToWideChar(CP_UTF8,MB_ERR_INVALID_CHARS,buffer.data(),int(length),text.data(),size);
  bytes.assign(buffer.data(),size_t(length));return true;
}
static std::wstring LiveXmlTransfer(const wchar_t *token,const wchar_t *domain,bool candidate) {
  std::wstring id=token;
  if(id.size()!=36||std::any_of(id.begin(),id.end(),[](wchar_t c){return !(c>=L'0'&&c<=L'9')&&!(c>=L'a'&&c<=L'f')&&c!=L'-';}))return L"";
  const auto temp=LiveTemporaryDirectory();if(temp.empty())return L"";
  std::wstring directory=temp+L"SC2EditorToolkit-live-"+domain;
  if(!LiveEnsureTransferDirectory(directory))return L"";
  return directory+L"\\"+id+(candidate?L".candidate.xml":L".xml");
}
