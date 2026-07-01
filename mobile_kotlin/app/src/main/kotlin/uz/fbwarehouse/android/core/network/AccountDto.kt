package uz.fbwarehouse.android.core.network

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class ChangePasswordRequestDto(
    @SerialName("current_password") val currentPassword: String,
    @SerialName("new_password") val newPassword: String,
)

@Serializable
data class StatusResponseDto(
    val status: String,
)

@Serializable
data class AppFeedbackCreateDto(
    val rating: Int,
    val comment: String? = null,
    val role: String,
    val module: String,
)

@Serializable
data class AppFeedbackOutDto(
    val id: String,
    val rating: Int,
    val comment: String? = null,
    val role: String,
    val module: String,
)
