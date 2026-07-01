package uz.fbwarehouse.android.core.network

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class LoginRequest(
    val username: String,
    val password: String,
)

@Serializable
data class TokenResponse(
    @SerialName("access_token") val accessToken: String,
    @SerialName("token_type") val tokenType: String = "bearer",
)

@Serializable
data class MeResponse(
    val id: String,
    val username: String,
    @SerialName("full_name") val fullName: String? = null,
    val role: String,
    val permissions: List<String> = emptyList(),
)

/** Backend HTTPException javobi: {"detail": "..."} yoki {"detail": {"message": "..."}} yoki {"detail": [...]}. */
@Serializable
data class ApiErrorBody(
    val detail: String? = null,
)
