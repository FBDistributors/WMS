import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/inventory_repository.dart';
import '../data/models/picker_inventory_models.dart';
import 'inventory_filter_providers.dart';

class InventoryViewState {
  const InventoryViewState({
    this.items = const <PickerInventoryItem>[],
    this.nextCursor,
    this.loading = false,
    this.loadingMore = false,
    this.error,
    this.headerRefreshing = false,
  });

  final List<PickerInventoryItem> items;
  final String? nextCursor;
  final bool loading;
  final bool loadingMore;
  final String? error;
  final bool headerRefreshing;

  InventoryViewState copyWith({
    List<PickerInventoryItem>? items,
    String? nextCursor,
    bool? loading,
    bool? loadingMore,
    String? error,
    bool? headerRefreshing,
  }) {
    return InventoryViewState(
      items: items ?? this.items,
      nextCursor: nextCursor ?? this.nextCursor,
      loading: loading ?? this.loading,
      loadingMore: loadingMore ?? this.loadingMore,
      error: error ?? this.error,
      headerRefreshing: headerRefreshing ?? this.headerRefreshing,
    );
  }
}

class InventoryListController extends StateNotifier<InventoryViewState> {
  InventoryListController(this._repository, this._ref)
      : super(const InventoryViewState(loading: true)) {
    _ref.listen<String>(inventoryQueryProvider, _onFilterChanged);
    _ref.listen<String>(inventoryLocationIdProvider, _onFilterChanged);
    _ref.listen<String>(inventoryBrandProvider, _onFilterChanged);
    _ref.listen<String>(inventoryWarehouseProvider, _onFilterChanged);
    Future<void>.microtask(() => load(reset: true));
  }

  static const int pageSize = 100;

  final InventoryRepository _repository;
  final Ref _ref;

  void _onFilterChanged(String? previous, String next) {
    if (previous == next) {
      return;
    }
    load(reset: true);
  }

  Future<void> load({bool reset = true}) async {
    state = InventoryViewState(
      items: state.items,
      nextCursor: null,
      loading: true,
      loadingMore: false,
      error: null,
      headerRefreshing: state.headerRefreshing,
    );

    try {
      final String q = _ref.read(inventoryQueryProvider);
      final String loc = _ref.read(inventoryLocationIdProvider);
      final String brand = _ref.read(inventoryBrandProvider);
      final String warehouse = _ref.read(inventoryWarehouseProvider);
      final PickerInventoryListResponse res = await _repository.listPickerInventory(
        q: q.trim().isEmpty ? null : q.trim(),
        locationId: loc.trim().isEmpty ? null : loc.trim(),
        brand: brand.trim().isEmpty ? null : brand.trim(),
        warehouse: warehouse.trim().isEmpty ? null : warehouse.trim(),
        limit: pageSize,
      );
      state = InventoryViewState(
        items: res.items,
        nextCursor: res.nextCursor,
        loading: false,
        loadingMore: false,
        error: null,
        headerRefreshing: state.headerRefreshing,
      );
    } on Exception catch (e) {
      state = InventoryViewState(
        items: state.items,
        nextCursor: state.nextCursor,
        loading: false,
        loadingMore: false,
        error: e.toString().replaceFirst('Exception: ', ''),
        headerRefreshing: state.headerRefreshing,
      );
    }
  }

  Future<void> refreshFromHeader() async {
    state = state.copyWith(headerRefreshing: true);
    try {
      await load(reset: true);
    } finally {
      state = state.copyWith(headerRefreshing: false);
    }
  }

  Future<void> loadMore() async {
    final String? cursor = state.nextCursor;
    if (cursor == null || state.loadingMore || state.loading) {
      return;
    }
    state = state.copyWith(loadingMore: true);
    try {
      final String q = _ref.read(inventoryQueryProvider);
      final String loc = _ref.read(inventoryLocationIdProvider);
      final String brand = _ref.read(inventoryBrandProvider);
      final String warehouse = _ref.read(inventoryWarehouseProvider);
      final PickerInventoryListResponse res = await _repository.listPickerInventory(
        q: q.trim().isEmpty ? null : q.trim(),
        locationId: loc.trim().isEmpty ? null : loc.trim(),
        brand: brand.trim().isEmpty ? null : brand.trim(),
        warehouse: warehouse.trim().isEmpty ? null : warehouse.trim(),
        limit: pageSize,
        cursor: cursor,
      );
      state = state.copyWith(
        items: <PickerInventoryItem>[...state.items, ...res.items],
        nextCursor: res.nextCursor,
        loadingMore: false,
      );
    } on Exception {
      state = state.copyWith(loadingMore: false);
    }
  }
}
