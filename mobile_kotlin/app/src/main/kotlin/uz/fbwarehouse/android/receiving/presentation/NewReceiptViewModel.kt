package uz.fbwarehouse.android.receiving.presentation

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import uz.fbwarehouse.android.core.network.AppError
import uz.fbwarehouse.android.core.network.InventoryByBarcodeDto
import uz.fbwarehouse.android.core.network.LocationDto
import uz.fbwarehouse.android.core.network.ReceiptLineCreateDto
import uz.fbwarehouse.android.inventory.data.InventoryRepository
import uz.fbwarehouse.android.receiving.data.LocationsRepository
import uz.fbwarehouse.android.receiving.data.ReceivingRepository
import javax.inject.Inject

/** Qabul hujjatiga qo'shilishi kutilayotgan bitta qator (hali serverga yuborilmagan). */
data class PendingReceiptLine(
    val productId: String,
    val productName: String,
    val locationId: String,
    val locationLabel: String,
    val qty: Int,
    val batch: String? = null,
    val expiryDate: String? = null,
    val boxBarcode: String? = null,
    val boxCount: Int? = null,
)

data class NewReceiptUiState(
    val barcodeQuery: String = "",
    val isSearching: Boolean = false,
    val foundProduct: InventoryByBarcodeDto? = null,
    val searchError: AppError? = null,
    val locations: List<LocationDto> = emptyList(),
    val selectedLocationId: String? = null,
    val qtyText: String = "",
    /** Yopiq quti skanerlanganda (scan_kind == "box") ishlatiladi — dona miqdori o'rniga quti soni. */
    val boxCountText: String = "",
    /** Ixtiyoriy — bo'sh bo'lsa backend avtomatik generatsiya qiladi. */
    val batchText: String = "",
    /** ISO-8601 (YYYY-MM-DD), ixtiyoriy. */
    val expiryDate: String? = null,
    val pendingLines: List<PendingReceiptLine> = emptyList(),
    val isSubmitting: Boolean = false,
    val submitError: AppError? = null,
    val lastReceiptDocNo: String? = null,
    /** Oxirgi qabul tarmoq yo'qligi sababli lokal navbatga saqlandi (hujjat raqami hali yo'q). */
    val lastReceiptQueued: Boolean = false,
) {
    val selectedLocation: LocationDto?
        get() = locations.firstOrNull { it.id == selectedLocationId }

    val isBoxScan: Boolean
        get() = foundProduct?.scanKind == "box"

    private val unitsPerBox: Int
        get() = foundProduct?.unitsPerBox ?: 1

    /** Quti skanerlanganda avtomatik hisoblangan dona miqdori (quti soni × quti sig'imi). */
    val computedBoxQty: Int?
        get() = if (isBoxScan) boxCountText.toIntOrNull()?.let { it * unitsPerBox } else null

    val canAddLine: Boolean
        get() = when {
            foundProduct == null || selectedLocationId == null -> false
            isBoxScan -> (boxCountText.toIntOrNull() ?: 0) > 0
            else -> (qtyText.toIntOrNull() ?: 0) > 0
        }

    val canSubmit: Boolean
        get() = pendingLines.isNotEmpty() && !isSubmitting
}

@HiltViewModel
class NewReceiptViewModel @Inject constructor(
    private val inventoryRepository: InventoryRepository,
    private val locationsRepository: LocationsRepository,
    private val receivingRepository: ReceivingRepository,
) : ViewModel() {

    private val _uiState = MutableStateFlow(NewReceiptUiState())
    val uiState: StateFlow<NewReceiptUiState> = _uiState.asStateFlow()

    init {
        viewModelScope.launch {
            // Avval navbatdagi (offline'da saqlangan) qabul hujjatlarini yuborishga urinamiz.
            runCatching { receivingRepository.syncPendingReceipts() }
        }
        loadLocations()
    }

    private fun loadLocations() {
        viewModelScope.launch {
            // Xato bo'lsa jim o'tkaziladi — foydalanuvchi qidiruvni davom ettiraveradi,
            // lokatsiya ro'yxati bo'sh ko'rinadi (submit tugmasi tanlanmagunча faol bo'lmaydi).
            locationsRepository.listActiveLocations()
                .onSuccess { locations -> _uiState.update { it.copy(locations = locations) } }
        }
    }

    fun onBarcodeChange(value: String) {
        _uiState.update { it.copy(barcodeQuery = value, searchError = null) }
    }

    /** Skaner ekranidan qaytgan barcode — maydonga qo'yiladi va darhol qidiriladi. */
    fun onBarcodeScanned(value: String) {
        _uiState.update { it.copy(barcodeQuery = value) }
        searchProduct()
    }

    fun onQtyChange(value: String) {
        _uiState.update { it.copy(qtyText = value.filter(Char::isDigit)) }
    }

    fun onBoxCountChange(value: String) {
        _uiState.update { it.copy(boxCountText = value.filter(Char::isDigit)) }
    }

    fun onLocationSelected(locationId: String) {
        _uiState.update { it.copy(selectedLocationId = locationId) }
    }

    fun onBatchChange(value: String) {
        _uiState.update { it.copy(batchText = value) }
    }

    fun onExpiryDateChange(isoDate: String?) {
        _uiState.update { it.copy(expiryDate = isoDate) }
    }

    fun searchProduct() {
        val query = _uiState.value.barcodeQuery.trim()
        if (query.isEmpty() || _uiState.value.isSearching) return
        viewModelScope.launch {
            _uiState.update {
                it.copy(
                    isSearching = true,
                    searchError = null,
                    foundProduct = null,
                    lastReceiptDocNo = null,
                    lastReceiptQueued = false,
                )
            }
            inventoryRepository.searchByBarcode(query)
                .onSuccess { product -> _uiState.update { it.copy(isSearching = false, foundProduct = product) } }
                .onFailure { e ->
                    _uiState.update {
                        it.copy(isSearching = false, searchError = e as? AppError ?: AppError.Unknown(e.message))
                    }
                }
        }
    }

    /** Joriy qidiruv natijasini navbatga qo'shadi; keyingi mahsulotni qidirish uchun maydonni tozalaydi. */
    fun addLine() {
        val state = _uiState.value
        val product = state.foundProduct ?: return
        val location = state.selectedLocation ?: return

        val boxCount = if (state.isBoxScan) state.boxCountText.toIntOrNull()?.takeIf { it > 0 } ?: return else null
        val qty = if (state.isBoxScan) state.computedBoxQty ?: return else state.qtyText.toIntOrNull()?.takeIf { it > 0 } ?: return

        val newLine = PendingReceiptLine(
            productId = product.productId,
            productName = product.name,
            locationId = location.id,
            locationLabel = "${location.code} — ${location.name}",
            qty = qty,
            batch = state.batchText.trim().ifBlank { null },
            expiryDate = state.expiryDate,
            boxBarcode = if (state.isBoxScan) product.boxBarcode else null,
            boxCount = boxCount,
        )
        _uiState.update {
            it.copy(
                pendingLines = it.pendingLines + newLine,
                barcodeQuery = "",
                foundProduct = null,
                qtyText = "",
                boxCountText = "",
                batchText = "",
                expiryDate = null,
                lastReceiptDocNo = null,
                lastReceiptQueued = false,
            )
        }
    }

    fun removeLine(index: Int) {
        _uiState.update { it.copy(pendingLines = it.pendingLines.filterIndexed { i, _ -> i != index }) }
    }

    fun submit() {
        val state = _uiState.value
        if (!state.canSubmit) return

        viewModelScope.launch {
            _uiState.update { it.copy(isSubmitting = true, submitError = null) }
            val lines = state.pendingLines.map {
                ReceiptLineCreateDto(
                    productId = it.productId,
                    qty = it.qty,
                    locationId = it.locationId,
                    batch = it.batch,
                    expiryDate = it.expiryDate,
                    boxBarcode = it.boxBarcode,
                    boxCount = it.boxCount,
                )
            }
            receivingRepository.receiveLines(lines)
                .onSuccess { outcome ->
                    when (outcome) {
                        is ReceivingRepository.ReceiveOutcome.Synced -> _uiState.update {
                            NewReceiptUiState(locations = it.locations, lastReceiptDocNo = outcome.response.docNo)
                        }
                        ReceivingRepository.ReceiveOutcome.Queued -> _uiState.update {
                            NewReceiptUiState(locations = it.locations, lastReceiptQueued = true)
                        }
                    }
                }
                .onFailure { e ->
                    _uiState.update {
                        it.copy(isSubmitting = false, submitError = e as? AppError ?: AppError.Unknown(e.message))
                    }
                }
        }
    }
}
