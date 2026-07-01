package uz.fbwarehouse.android.feedback.presentation

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
import uz.fbwarehouse.android.feedback.data.FeedbackRepository
import javax.inject.Inject

data class FeedbackUiState(
    val rating: Int = 0,
    val comment: String = "",
    val isSubmitting: Boolean = false,
    val error: AppError? = null,
    val submitted: Boolean = false,
) {
    val canSubmit: Boolean
        get() = rating in 1..5 && !isSubmitting
}

@HiltViewModel
class FeedbackViewModel @Inject constructor(
    private val repository: FeedbackRepository,
    savedStateHandle: SavedStateHandle,
) : ViewModel() {

    private val role: String = savedStateHandle["role"] ?: "picker"

    private val _uiState = MutableStateFlow(FeedbackUiState())
    val uiState: StateFlow<FeedbackUiState> = _uiState.asStateFlow()

    fun onRatingChange(value: Int) {
        _uiState.update { it.copy(rating = value, error = null) }
    }

    fun onCommentChange(value: String) {
        _uiState.update { it.copy(comment = value) }
    }

    fun submit() {
        val state = _uiState.value
        if (!state.canSubmit) return
        viewModelScope.launch {
            _uiState.update { it.copy(isSubmitting = true, error = null) }
            repository.submit(rating = state.rating, comment = state.comment, role = role)
                .onSuccess { _uiState.update { FeedbackUiState(submitted = true) } }
                .onFailure { e ->
                    _uiState.update {
                        it.copy(isSubmitting = false, error = e as? AppError ?: AppError.Unknown(e.message))
                    }
                }
        }
    }
}
