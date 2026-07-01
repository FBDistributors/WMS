package uz.fbwarehouse.android.auth.presentation

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import uz.fbwarehouse.android.auth.data.AuthRepository
import uz.fbwarehouse.android.core.network.AppError
import uz.fbwarehouse.android.core.network.MeResponse
import javax.inject.Inject

data class LoginUiState(
    val username: String = "",
    val password: String = "",
    val isLoading: Boolean = false,
    val error: AppError? = null,
)

sealed class SessionState {
    data object Checking : SessionState()
    data object LoggedOut : SessionState()
    data class LoggedIn(val user: MeResponse) : SessionState()
}

@HiltViewModel
class AuthViewModel @Inject constructor(
    private val repository: AuthRepository,
) : ViewModel() {

    private val _uiState = MutableStateFlow(LoginUiState())
    val uiState: StateFlow<LoginUiState> = _uiState.asStateFlow()

    private val _session = MutableStateFlow<SessionState>(SessionState.Checking)
    val session: StateFlow<SessionState> = _session.asStateFlow()

    init {
        viewModelScope.launch {
            val hasToken = repository.isLoggedIn.first()
            if (hasToken) refreshMe() else _session.value = SessionState.LoggedOut
        }
    }

    fun onUsernameChange(value: String) {
        _uiState.update { it.copy(username = value, error = null) }
    }

    fun onPasswordChange(value: String) {
        _uiState.update { it.copy(password = value, error = null) }
    }

    fun submit() {
        val state = _uiState.value
        if (state.username.isBlank() || state.password.isBlank() || state.isLoading) return
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, error = null) }
            repository.login(state.username.trim(), state.password)
                .onSuccess {
                    refreshMe()
                    _uiState.update { LoginUiState() }
                }
                .onFailure { e ->
                    _uiState.update {
                        it.copy(isLoading = false, error = e as? AppError ?: AppError.Unknown(e.message))
                    }
                }
        }
    }

    fun logout() {
        viewModelScope.launch {
            repository.logout()
            _session.value = SessionState.LoggedOut
            _uiState.value = LoginUiState()
        }
    }

    private suspend fun refreshMe() {
        repository.me()
            .onSuccess { user -> _session.value = SessionState.LoggedIn(user) }
            .onFailure { _session.value = SessionState.LoggedOut }
    }
}
