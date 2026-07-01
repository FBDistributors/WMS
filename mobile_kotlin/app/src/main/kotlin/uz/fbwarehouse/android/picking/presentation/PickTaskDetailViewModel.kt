package uz.fbwarehouse.android.picking.presentation

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import uz.fbwarehouse.android.core.network.AppError
import uz.fbwarehouse.android.core.network.PickingDocumentDto
import uz.fbwarehouse.android.inventory.data.InventoryRepository
import uz.fbwarehouse.android.picking.data.PickingRepository
import javax.inject.Inject

data class PickTaskDetailUiState(
    val isLoading: Boolean = true,
    val document: PickingDocumentDto? = null,
    val error: AppError? = null,
    /** Hozir yuborilayotgan qator id — shu qatorning tugmasi bloklanadi. */
    val submittingLineId: String? = null,
    /** Skanerlangan shtrix-kod ushbu hujjatning hech bir qatoriga mos kelmadi. */
    val scanNotFound: Boolean = false,
    /** Oxirgi pick amali tarmoq yo'qligi sababli lokal navbatga saqlandi. */
    val lastPickQueued: Boolean = false,
)

@HiltViewModel
class PickTaskDetailViewModel @Inject constructor(
    private val repository: PickingRepository,
    private val inventoryRepository: InventoryRepository,
    savedStateHandle: SavedStateHandle,
) : ViewModel() {

    private val documentId: String = checkNotNull(savedStateHandle["documentId"]) {
        "documentId navigatsiya argumenti berilmagan"
    }

    private val _uiState = MutableStateFlow(PickTaskDetailUiState())
    val uiState: StateFlow<PickTaskDetailUiState> = _uiState.asStateFlow()

    init {
        load()
    }

    fun load() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, error = null) }
            // Avval navbatdagi (offline'da saqlangan) pick'larni yuborishga urinamiz — bu safar
            // internet bo'lsa, hujjat serverdan eng yangi holatda o'qiladi.
            runCatching { repository.syncPendingPicks() }
            repository.getDocument(documentId)
                .onSuccess { doc -> _uiState.update { it.copy(isLoading = false, document = doc) } }
                .onFailure { e ->
                    _uiState.update {
                        it.copy(isLoading = false, error = e as? AppError ?: AppError.Unknown(e.message))
                    }
                }
        }
    }

    fun pickLine(lineId: String, delta: Int, barcode: String? = null, boxCount: Int? = null) {
        if (delta == 0 || _uiState.value.submittingLineId != null) return
        viewModelScope.launch {
            _uiState.update { it.copy(submittingLineId = lineId, error = null) }
            repository.pickLine(lineId, delta, barcode, boxCount)
                .onSuccess { outcome ->
                    when (outcome) {
                        is PickingRepository.PickOutcome.Synced -> {
                            // Sodda va ishonchli: butun hujjatni qayta yuklaymiz — progress/status server bilan mos.
                            load()
                            _uiState.update { it.copy(submittingLineId = null) }
                        }
                        PickingRepository.PickOutcome.Queued -> {
                            // Offline: serverga hali yetmadi — progress'ni lokal (optimistik) yangilaymiz,
                            // internet qaytganda `load()` ichidagi sync haqiqiy holatni tasdiqlaydi.
                            _uiState.update { state ->
                                state.copy(
                                    submittingLineId = null,
                                    lastPickQueued = true,
                                    document = state.document?.let { applyOptimisticDelta(it, lineId, delta) },
                                )
                            }
                        }
                    }
                }
                .onFailure { e ->
                    _uiState.update {
                        it.copy(
                            submittingLineId = null,
                            error = e as? AppError ?: AppError.Unknown(e.message),
                        )
                    }
                }
        }
    }

    /**
     * Skan orqali terish. Avval qatorning o'z (dona) shtrix-kodiga to'g'ridan-to'g'ri moslikka
     * tekshiradi (tezkor yo'l). Mos kelmasa, kod yopiq **quti** shtrix-kodi bo'lishi mumkin —
     * inventarizatsiya orqali hal qilinadi (`scan_kind == "box"`): shu holda 1 quti (1 quti
     * sig'imi qadar dona) qo'shiladi.
     */
    fun pickLineByBarcode(barcode: String) {
        val doc = _uiState.value.document ?: return
        val normalized = barcode.trim()

        val directLine = doc.lines.firstOrNull {
            !it.isVipExpiryInformational &&
                it.qtyPicked < it.qtyRequired &&
                it.barcode != null &&
                it.barcode.equals(normalized, ignoreCase = true)
        }
        if (directLine != null) {
            pickLine(directLine.id, delta = 1, barcode = normalized)
            return
        }

        viewModelScope.launch {
            inventoryRepository.searchByBarcode(normalized)
                .onSuccess { resolved ->
                    val matchingLine = doc.lines.firstOrNull {
                        !it.isVipExpiryInformational &&
                            it.qtyPicked < it.qtyRequired &&
                            it.productId == resolved.productId
                    }
                    if (matchingLine == null) {
                        _uiState.update { it.copy(scanNotFound = true) }
                        return@onSuccess
                    }
                    if (resolved.scanKind == "box") {
                        val unitsPerBox = resolved.unitsPerBox ?: 1
                        pickLine(matchingLine.id, delta = unitsPerBox, barcode = normalized, boxCount = 1)
                    } else {
                        pickLine(matchingLine.id, delta = 1, barcode = normalized)
                    }
                }
                .onFailure {
                    _uiState.update { it.copy(scanNotFound = true) }
                }
        }
    }

    fun consumeScanNotFound() {
        _uiState.update { it.copy(scanNotFound = false) }
    }

    fun consumeLastPickQueued() {
        _uiState.update { it.copy(lastPickQueued = false) }
    }

    private fun applyOptimisticDelta(
        document: PickingDocumentDto,
        lineId: String,
        delta: Int,
    ): PickingDocumentDto {
        val updatedLines = document.lines.map { line ->
            if (line.id == lineId) {
                val newQty = (line.qtyPicked + delta).coerceIn(0.0, line.qtyRequired)
                line.copy(qtyPicked = newQty)
            } else {
                line
            }
        }
        return document.copy(lines = updatedLines)
    }
}
