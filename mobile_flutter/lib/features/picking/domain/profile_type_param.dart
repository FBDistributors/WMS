enum PickerProfileParam {
  picker,
  controller,
}

PickerProfileParam pickerProfileFromQuery(String? v) {
  return v == 'controller' ? PickerProfileParam.controller : PickerProfileParam.picker;
}

String profileToQuery(PickerProfileParam p) =>
    p == PickerProfileParam.controller ? 'controller' : 'picker';
