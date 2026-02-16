import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { ProductByBarcode } from '../api/types';

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
});

interface ProductCardProps {
  product: ProductByBarcode;
}

export function ProductCard({ product }: ProductCardProps) {
  const onHand = product.on_hand_total ?? 0;
  const available = product.available_total ?? 0;

  return (
    <View style={styles.card}>
      <Text style={styles.name} numberOfLines={2}>
        {product.name}
      </Text>
      <View style={styles.row}>
        <Text style={styles.label}>SKU</Text>
        <Text style={styles.value}>{product.sku}</Text>
      </View>
      {(product.barcode || (product.barcodes && product.barcodes.length > 0)) && (
        <View style={styles.row}>
          <Text style={styles.label}>Barcode</Text>
          <Text style={styles.value}>
            {product.barcode || product.barcodes?.[0] || '—'}
          </Text>
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
          Stock: {available} available{onHand !== available ? ` (${onHand} on hand)` : ''}
        </Text>
      </View>
    </View>
  );
}
