enum ProfileType {
  picker,
  controller,
}

extension ProfileTypeStorage on ProfileType {
  String get storageValue => name;
}

ProfileType profileTypeFromStorage(String? raw) {
  return switch (raw) {
    'controller' => ProfileType.controller,
    _ => ProfileType.picker,
  };
}
