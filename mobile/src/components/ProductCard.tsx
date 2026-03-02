import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { InventoryByBarcodeResponse } from '../api/inventory';

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginHorizontal: 16,
    marginVertical: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  name: {
    fontSize: 18,
    fontWeight: '600',
    color: '#111',
    marginBottom: 4,
  },
  row: {
    flexDirection: 'row',
    marginTop: 4,
  },
  label: {
    fontSize: 14,
    color: '#666',
    width: 100,
  },
  value: {
    fontSize: 14,
    color: '#111',
    flex: 1,
  },
  stock: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#eee',
  },
  stockText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#0a0',
  },
  locationsTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginTop: 8,
    marginBottom: 4,
  },
  locationRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
    paddingHorizontal: 0,
  },
  locationCode: {
    fontSize: 14,
    color: '#111',
    fontWeight: '500',
  },
  locationQty: {
    fontSize: 14,
    color: '#0a0',
  },
});

interface ProductCardProps {
  product: InventoryByBarcodeResponse;
}

export function ProductCard({ product }: ProductCardProps) {
  const total = Math.round(Number(product.total_available ?? 0));
  const locations = product.best_locations ?? [];

  return (
    <View style={styles.card}>
      <Text style={styles.name} numberOfLines={2}>
        {product.name}
      </Text>
      {product.barcode && (
        <View style={styles.row}>
          <Text style={styles.label}>Barcode</Text>
          <Text style={styles.value}>{product.barcode}</Text>
        </View>
      )}
      {product.brand && (
        <View style={styles.row}>
          <Text style={styles.label}>Brand</Text>
          <Text style={styles.value}>{product.brand}</Text>
        </View>
      )}
      <View style={styles.stock}>
        <Text style={styles.stockText}>
          Jami mavjud: {total} dona
        </Text>
      </View>
      {locations.length > 0 && (
        <>
          <Text style={styles.locationsTitle}>Qayerda:</Text>
          {locations.map((loc, i) => (
            <View key={`${loc.location_code}-${i}`} style={styles.locationRow}>
              <Text style={styles.locationCode}>{loc.location_code}</Text>
              <Text style={styles.locationQty}>{Math.round(Number(loc.available_qty))} dona</Text>
            </View>
          ))}
        </>
      )}
    </View>
  );
}
