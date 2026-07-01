package uz.fbwarehouse.android.auth.data

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import uz.fbwarehouse.android.core.network.ApiService
import uz.fbwarehouse.android.core.network.ChangePasswordRequestDto
import uz.fbwarehouse.android.core.network.LoginRequest
import uz.fbwarehouse.android.core.network.MeResponse
import uz.fbwarehouse.android.core.network.toAppError
import uz.fbwarehouse.android.core.storage.TokenDataStore
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class AuthRepository @Inject constructor(
    private val apiService: ApiService,
    private val tokenDataStore: TokenDataStore,
) {
    val isLoggedIn: Flow<Boolean> = tokenDataStore.tokenFlow.map { !it.isNullOrBlank() }

    suspend fun login(username: String, password: String): Result<Unit> = runCatching {
        val token = apiService.login(LoginRequest(username = username, password = password))
        tokenDataStore.saveToken(token.accessToken)
    }.recoverCatching { throw it.toAppError() }

    suspend fun me(): Result<MeResponse> = runCatching {
        apiService.me()
    }.recoverCatching { throw it.toAppError() }

    suspend fun logout() {
        runCatching { apiService.logout() }
        tokenDataStore.clearToken()
    }

    suspend fun changePassword(currentPassword: String, newPassword: String): Result<Unit> = runCatching {
        apiService.changePassword(
            ChangePasswordRequestDto(currentPassword = currentPassword, newPassword = newPassword)
        )
        Unit
    }.recoverCatching { throw it.toAppError() }
}
