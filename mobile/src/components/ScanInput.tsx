import React, { useState } from 'react';
import {
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

export interface ScanInputProps {
  onSubmit: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  label?: string;
  submitText?: string;
}

export function ScanInput({
  onSubmit,
  placeholder = 'Shtrixkod / SKU kiriting',
  disabled = false,
  label = 'Shtrixkod / SKU',
  submitText = 'Yuborish',
}: ScanInputProps) {
  const [value, setValue] = useState('');

  const handleSubmit = () => {
    const trimmed = value.trim();
    if (trimmed) {
      onSubmit(trimmed);
      setValue('');
    }
  };

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={[styles.input, disabled && styles.inputDisabled]}
        value={value}
        onChangeText={setValue}
        onSubmitEditing={handleSubmit}
        returnKeyType="done"
        placeholder={placeholder}
        placeholderTextColor="#999"
        editable={!disabled}
        autoCapitalize="none"
        autoCorrect={false}
      />
      <TouchableOpacity
        style={[styles.btn, disabled && styles.btnDisabled]}
        onPress={handleSubmit}
        disabled={disabled || !value.trim()}
      >
        <Text style={styles.btnText}>{submitText}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginHorizontal: 16, marginTop: 12 },
  label: { fontSize: 14, color: '#333', marginBottom: 6 },
  input: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 16,
    color: '#111',
  },
  inputDisabled: { backgroundColor: '#f0f0f0', color: '#666' },
  btn: {
    marginTop: 8,
    backgroundColor: '#1976d2',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  btnDisabled: { opacity: 0.6 },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
