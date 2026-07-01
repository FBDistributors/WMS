package uz.fbwarehouse.android.auth.presentation

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import uz.fbwarehouse.android.auth.data.AuthRepository
import uz.fbwarehouse.android.core.network.AppError
import javax.inject.Inject

data class ChangePasswordUiState(
    val currentPassword: String = "",
    val newPassword: String = "",
    val confirmPassword: String = "",
    val isSubmitting: Boolean = false,
    val error: AppError? = null,
    val success: Boolean = false,
) {
    val passwordsMismatch: Boolean
        get() = confirmPassword.isNotEmpty() && newPassword != confirmPassword

    val canSubmit: Boolean
        get() = currentPassword.isNotBlank() &&
            newPassword.length >= 6 &&
            newPassword == confirmPassword &&
            !isSubmitting
}

@HiltViewModel
class ChangePasswordViewModel @Inject constructor(
    private val repository: AuthRepository,
) : ViewModel() {

    private val _uiState = MutableStateFlow(ChangePasswordUiState())
    val uiState: StateFlow<ChangePasswordUiState> = _uiState.asStateFlow()

    fun onCurrentPasswordChange(value: String) {
        _uiState.update { it.copy(currentPassword = value, error = null) }
    }

    fun onNewPasswordChange(value: String) {
        _uiState.update { it.copy(newPassword = value, error = null) }
    }

    fun onConfirmPasswordChange(value: String) {
        _uiState.update { it.copy(confirmPassword = value, error = null) }
    }

    fun submit() {
        val state = _uiState.value
        if (!state.canSubmit) return
        viewModelScope.launch {
            _uiState.update { it.copy(isSubmitting = true, error = null) }
            repository.changePassword(state.currentPassword, state.newPassword)
                .onSuccess { _uiState.update { ChangePasswordUiState(success = true) } }
                .onFailure { e ->
                    _uiState.update {
                        it.copy(isSubmitting = false, error = e as? AppError ?: AppError.Unknown(e.message))
                    }
                }
        }
    }
}
