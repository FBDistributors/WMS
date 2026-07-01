package uz.fbwarehouse.android.picking.presentation

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import uz.fbwarehouse.android.core.network.AppError
import uz.fbwarehouse.android.core.network.PickingListItemDto
import uz.fbwarehouse.android.picking.data.PickingRepository
import javax.inject.Inject

data class PickTaskListUiState(
    val isLoading: Boolean = true,
    val items: List<PickingListItemDto> = emptyList(),
    val error: AppError? = null,
)

@HiltViewModel
class PickTaskListViewModel @Inject constructor(
    private val repository: PickingRepository,
) : ViewModel() {

    private val _uiState = MutableStateFlow(PickTaskListUiState())
    val uiState: StateFlow<PickTaskListUiState> = _uiState.asStateFlow()

    init {
        load()
    }

    fun load() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, error = null) }
            repository.listDocuments()
                .onSuccess { items -> _uiState.update { it.copy(isLoading = false, items = items) } }
                .onFailure { e ->
                    _uiState.update {
                        it.copy(isLoading = false, error = e as? AppError ?: AppError.Unknown(e.message))
                    }
                }
        }
    }
}
