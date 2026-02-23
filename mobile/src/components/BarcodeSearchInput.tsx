/**
 * Shtrix kod / mahsulot kiritilganda avto-qidiruv dropdown.
 * listPickerInventory(q) orqali natijalar ko'rsatiladi, tanlansa onSelectProduct chaqiriladi.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { listPickerInventory, type PickerInventoryItem } from '../api/inventory';

const DEBOUNCE_MS = 400;
const MAX_RESULTS = 15;

type BarcodeSearchInputProps = {
  value: string;
  onChangeText: (text: string) => void;
  onSelectProduct: (productId: string) => void;
  placeholder?: string;
  emptyLabel?: string;
  loading?: boolean;
  error?: string | null;
  onClearError?: () => void;
  style?: object;
  dropdownMaxHeight?: number;
};

export function BarcodeSearchInput({
  value,
  onChangeText,
  onSelectProduct,
  placeholder = "Barkod yoki SKU kiriting",
  emptyLabel = "Natija yo'q",
  loading = false,
  error,
  onClearError,
  style,
  dropdownMaxHeight = 220,
}: BarcodeSearchInputProps) {
  const [searchResults, setSearchResults] = useState<PickerInventoryItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);

  useEffect(() => {
    const q = value.trim();
    if (!q || q.length < 1) {
      setSearchResults([]);
      setShowDropdown(false);
      return;
    }
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await listPickerInventory({ q, limit: MAX_RESULTS });
        setSearchResults(res.items || []);
        setShowDropdown(true);
      } catch {
        setSearchResults([]);
        setShowDropdown(false);
      } finally {
        setSearching(false);
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [value]);

  const handleSelect = useCallback(
    (item: PickerInventoryItem) => {
      onSelectProduct(item.product_id);
      onChangeText('');
      setShowDropdown(false);
      setSearchResults([]);
    },
    [onSelectProduct, onChangeText]
  );

  const handleChangeText = useCallback(
    (text: string) => {
      onChangeText(text);
      onClearError?.();
    },
    [onChangeText, onClearError]
  );

  return (
    <View style={[styles.wrap, style]}>
      <View style={styles.inputRow}>
        <TextInput
          style={[styles.input, error ? styles.inputError : null]}
          value={value}
          onChangeText={handleChangeText}
          placeholder={placeholder}
          placeholderTextColor="#999"
          autoCapitalize="none"
          autoCorrect={false}
          onFocus={() => value.trim().length > 0 && searchResults.length > 0 && setShowDropdown(true)}
          onBlur={() => setTimeout(() => setShowDropdown(false), 200)}
        />
        {(searching || loading) && (
          <View style={styles.loaderWrap}>
            <ActivityIndicator size="small" color="#1a237e" />
          </View>
        )}
      </View>
      {showDropdown && searchResults.length > 0 && (
        <View style={[styles.dropdown, { maxHeight: dropdownMaxHeight }]}>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            nestedScrollEnabled
            showsVerticalScrollIndicator
          >
            {searchResults.map((item) => (
              <TouchableOpacity
                key={item.product_id}
                style={styles.dropdownItem}
                onPress={() => handleSelect(item)}
                activeOpacity={0.7}
              >
                <Text style={styles.dropdownItemCode} numberOfLines={1}>
                  {item.code}
                </Text>
                <Text style={styles.dropdownItemName} numberOfLines={1}>
                  {item.name}
                </Text>
                {item.main_barcode ? (
                  <Text style={styles.dropdownItemBarcode} numberOfLines={1}>
                    {item.main_barcode}
                  </Text>
                ) : null}
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}
      {showDropdown && value.trim().length > 0 && !searching && searchResults.length === 0 && (
        <View style={styles.dropdown}>
          <Text style={styles.dropdownEmpty}>{emptyLabel}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'relative', zIndex: 10 },
  inputRow: { position: 'relative' },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    paddingRight: 40,
    fontSize: 16,
    backgroundColor: '#fff',
    color: '#333',
  },
  inputError: { borderColor: '#c62828' },
  loaderWrap: {
    position: 'absolute',
    right: 12,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
  },
  dropdown: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: '100%',
    marginTop: 4,
    backgroundColor: '#fff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 4,
  },
  dropdownItem: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#eee',
  },
  dropdownItemCode: { fontSize: 14, fontWeight: '600', color: '#333' },
  dropdownItemName: { fontSize: 13, color: '#555', marginTop: 2 },
  dropdownItemBarcode: { fontSize: 12, color: '#777', marginTop: 1 },
  dropdownEmpty: { padding: 12, fontSize: 14, color: '#777', textAlign: 'center' },
});
