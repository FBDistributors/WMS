package uz.fbwarehouse.android.movement.presentation

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import uz.fbwarehouse.android.core.network.AppError
import uz.fbwarehouse.android.core.network.LocationDto
import uz.fbwarehouse.android.core.network.LocationTransferResponseDto
import uz.fbwarehouse.android.movement.data.MovementsRepository
import uz.fbwarehouse.android.receiving.data.LocationsRepository
import javax.inject.Inject

data class MovementUiState(
    val locations: List<LocationDto> = emptyList(),
    val fromLocationId: String? = null,
    val toLocationId: String? = null,
    val isSubmitting: Boolean = false,
    val error: AppError? = null,
    val result: LocationTransferResponseDto? = null,
) {
    val fromLocation: LocationDto?
        get() = locations.firstOrNull { it.id == fromLocationId }

    val toLocation: LocationDto?
        get() = locations.firstOrNull { it.id == toLocationId }

    val canSubmit: Boolean
        get() = fromLocationId != null && toLocationId != null && fromLocationId != toLocationId && !isSubmitting
}

@HiltViewModel
class MovementViewModel @Inject constructor(
    private val locationsRepository: LocationsRepository,
    private val movementsRepository: MovementsRepository,
) : ViewModel() {

    private val _uiState = MutableStateFlow(MovementUiState())
    val uiState: StateFlow<MovementUiState> = _uiState.asStateFlow()

    init {
        viewModelScope.launch {
            locationsRepository.listActiveLocations()
                .onSuccess { locations -> _uiState.update { it.copy(locations = locations) } }
        }
    }

    fun onFromLocationSelected(id: String) {
        _uiState.update { it.copy(fromLocationId = id, result = null, error = null) }
    }

    fun onToLocationSelected(id: String) {
        _uiState.update { it.copy(toLocationId = id, result = null, error = null) }
    }

    fun submit() {
        val state = _uiState.value
        if (!state.canSubmit) return
        val fromId = state.fromLocationId ?: return
        val toId = state.toLocationId ?: return
        viewModelScope.launch {
            _uiState.update { it.copy(isSubmitting = true, error = null) }
            movementsRepository.transferAllLoose(fromId, toId)
                .onSuccess { response -> _uiState.update { it.copy(isSubmitting = false, result = response) } }
                .onFailure { e ->
                    _uiState.update {
                        it.copy(isSubmitting = false, error = e as? AppError ?: AppError.Unknown(e.message))
                    }
                }
        }
    }
}
