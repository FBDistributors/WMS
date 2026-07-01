package uz.fbwarehouse.android.customerreturns.presentation

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import uz.fbwarehouse.android.core.network.AppError
import uz.fbwarehouse.android.core.network.CustomerReturnOutDto
import uz.fbwarehouse.android.customerreturns.data.CustomerReturnsRepository
import javax.inject.Inject

data class CustomerReturnQueueUiState(
    val isLoading: Boolean = true,
    val items: List<CustomerReturnOutDto> = emptyList(),
    val error: AppError? = null,
)

@HiltViewModel
class CustomerReturnQueueViewModel @Inject constructor(
    private val repository: CustomerReturnsRepository,
) : ViewModel() {

    private val _uiState = MutableStateFlow(CustomerReturnQueueUiState())
    val uiState: StateFlow<CustomerReturnQueueUiState> = _uiState.asStateFlow()

    init {
        load()
    }

    /**
     * Controller uchun tekshirish kutayotgan (pending_controller) va picker uchun menga
     * biriktirilgan (assigned_to_picker) qaytarishlarni birlashtirib ko'rsatadi. Rol mos
     * kelmagani uchun bittasi 403/xato bersa — jim o'tkaziladi (bo'sh ro'yxat deb olinadi);
     * ikkalasi ham muvaffaqiyatsiz bo'lsagina xato ko'rsatiladi (masalan tarmoq yo'q).
     */
    fun load() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, error = null) }
            val pendingResult = repository.listPendingApproval()
            val assignedResult = repository.listAssignedToMe()

            if (pendingResult.isFailure && assignedResult.isFailure) {
                val e = pendingResult.exceptionOrNull() ?: assignedResult.exceptionOrNull()
                _uiState.update {
                    it.copy(isLoading = false, error = e as? AppError ?: AppError.Unknown(e?.message))
                }
                return@launch
            }

            val merged = (pendingResult.getOrNull().orEmpty() + assignedResult.getOrNull().orEmpty())
                .distinctBy { it.id }
            _uiState.update { it.copy(isLoading = false, items = merged) }
        }
    }
}
