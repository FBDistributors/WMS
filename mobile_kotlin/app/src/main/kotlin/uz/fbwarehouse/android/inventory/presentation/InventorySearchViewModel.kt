package uz.fbwarehouse.android.inventory.presentation

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
import uz.fbwarehouse.android.inventory.data.InventoryRepository
import javax.inject.Inject

data class InventorySearchUiState(
    val query: String = "",
    val isLoading: Boolean = false,
    val result: InventoryByBarcodeDto? = null,
    val error: AppError? = null,
    val hasSearched: Boolean = false,
)

@HiltViewModel
class InventorySearchViewModel @Inject constructor(
    private val repository: InventoryRepository,
) : ViewModel() {

    private val _uiState = MutableStateFlow(InventorySearchUiState())
    val uiState: StateFlow<InventorySearchUiState> = _uiState.asStateFlow()

    fun onQueryChange(value: String) {
        _uiState.update { it.copy(query = value) }
    }

    /** Skaner ekranidan qaytgan barcode — maydonga qo'yiladi va darhol qidiriladi. */
    fun onBarcodeScanned(value: String) {
        _uiState.update { it.copy(query = value) }
        search()
    }

    fun search() {
        val query = _uiState.value.query.trim()
        if (query.isEmpty() || _uiState.value.isLoading) return
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, error = null, hasSearched = true) }
            repository.searchByBarcode(query)
                .onSuccess { result -> _uiState.update { it.copy(isLoading = false, result = result) } }
                .onFailure { e ->
                    _uiState.update {
                        it.copy(
                            isLoading = false,
                            result = null,
                            error = e as? AppError ?: AppError.Unknown(e.message),
                        )
                    }
                }
        }
    }
}
