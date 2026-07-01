package uz.fbwarehouse.android.customerreturns.presentation

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
import uz.fbwarehouse.android.core.network.CustomerReturnOutDto
import uz.fbwarehouse.android.core.network.LocationDto
import uz.fbwarehouse.android.core.network.PickerUserDto
import uz.fbwarehouse.android.customerreturns.data.CustomerReturnsRepository
import uz.fbwarehouse.android.receiving.data.LocationsRepository
import javax.inject.Inject

const val CUSTOMER_RETURN_STATUS_PENDING = "pending_controller"
const val CUSTOMER_RETURN_STATUS_APPROVED = "approved"
const val CUSTOMER_RETURN_STATUS_ASSIGNED = "assigned_to_picker"
const val CUSTOMER_RETURN_STATUS_COMPLETED = "completed"

data class CustomerReturnDetailUiState(
    val isLoading: Boolean = true,
    val customerReturn: CustomerReturnOutDto? = null,
    val error: AppError? = null,
    val isApproving: Boolean = false,
    // Picker'ga biriktirish (status == approved bo'lganda)
    val pickers: List<PickerUserDto> = emptyList(),
    val selectedPickerId: String? = null,
    val isAssigning: Boolean = false,
    // Yakunlash (status == assigned_to_picker bo'lganda)
    val locations: List<LocationDto> = emptyList(),
    val selectedLocationId: String? = null,
    val isCompleting: Boolean = false,
)

@HiltViewModel
class CustomerReturnDetailViewModel @Inject constructor(
    private val repository: CustomerReturnsRepository,
    private val locationsRepository: LocationsRepository,
    savedStateHandle: SavedStateHandle,
) : ViewModel() {

    private val returnId: String = checkNotNull(savedStateHandle["returnId"]) {
        "returnId navigatsiya argumenti berilmagan"
    }

    private val _uiState = MutableStateFlow(CustomerReturnDetailUiState())
    val uiState: StateFlow<CustomerReturnDetailUiState> = _uiState.asStateFlow()

    init {
        load()
    }

    fun load() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, error = null) }
            repository.getReturn(returnId)
                .onSuccess { cr ->
                    _uiState.update { it.copy(isLoading = false, customerReturn = cr) }
                    when (cr.status) {
                        CUSTOMER_RETURN_STATUS_APPROVED -> loadPickers()
                        CUSTOMER_RETURN_STATUS_ASSIGNED -> loadLocations()
                    }
                }
                .onFailure { e ->
                    _uiState.update {
                        it.copy(isLoading = false, error = e as? AppError ?: AppError.Unknown(e.message))
                    }
                }
        }
    }

    private fun loadPickers() {
        viewModelScope.launch {
            repository.listPickers().onSuccess { pickers -> _uiState.update { it.copy(pickers = pickers) } }
        }
    }

    private fun loadLocations() {
        viewModelScope.launch {
            locationsRepository.listActiveLocations()
                .onSuccess { locations -> _uiState.update { it.copy(locations = locations) } }
        }
    }

    fun approve() {
        if (_uiState.value.isApproving) return
        viewModelScope.launch {
            _uiState.update { it.copy(isApproving = true, error = null) }
            repository.approve(returnId)
                .onSuccess { cr -> _uiState.update { it.copy(isApproving = false, customerReturn = cr) }; loadPickers() }
                .onFailure { e ->
                    _uiState.update {
                        it.copy(isApproving = false, error = e as? AppError ?: AppError.Unknown(e.message))
                    }
                }
        }
    }

    fun onPickerSelected(pickerId: String) {
        _uiState.update { it.copy(selectedPickerId = pickerId) }
    }

    fun assignPicker() {
        val pickerId = _uiState.value.selectedPickerId ?: return
        if (_uiState.value.isAssigning) return
        viewModelScope.launch {
            _uiState.update { it.copy(isAssigning = true, error = null) }
            repository.assignPicker(returnId, pickerId)
                .onSuccess { cr ->
                    _uiState.update { it.copy(isAssigning = false, customerReturn = cr) }
                    loadLocations()
                }
                .onFailure { e ->
                    _uiState.update {
                        it.copy(isAssigning = false, error = e as? AppError ?: AppError.Unknown(e.message))
                    }
                }
        }
    }

    fun onLocationSelected(locationId: String) {
        _uiState.update { it.copy(selectedLocationId = locationId) }
    }

    fun complete() {
        val locationId = _uiState.value.selectedLocationId ?: return
        if (_uiState.value.isCompleting) return
        viewModelScope.launch {
            _uiState.update { it.copy(isCompleting = true, error = null) }
            repository.complete(returnId, locationId)
                .onSuccess { cr -> _uiState.update { it.copy(isCompleting = false, customerReturn = cr) } }
                .onFailure { e ->
                    _uiState.update {
                        it.copy(isCompleting = false, error = e as? AppError ?: AppError.Unknown(e.message))
                    }
                }
        }
    }
}
