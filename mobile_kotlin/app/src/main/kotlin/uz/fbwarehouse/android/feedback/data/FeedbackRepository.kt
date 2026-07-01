package uz.fbwarehouse.android.feedback.data

import uz.fbwarehouse.android.core.network.AppFeedbackCreateDto
import uz.fbwarehouse.android.core.network.AppFeedbackOutDto
import uz.fbwarehouse.android.core.network.ApiService
import uz.fbwarehouse.android.core.network.toAppError
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class FeedbackRepository @Inject constructor(
    private val apiService: ApiService,
) {
    suspend fun submit(
        rating: Int,
        comment: String?,
        role: String,
        module: String = "general",
    ): Result<AppFeedbackOutDto> = runCatching {
        apiService.submitAppFeedback(
            AppFeedbackCreateDto(rating = rating, comment = comment?.ifBlank { null }, role = role, module = module)
        )
    }.recoverCatching { throw it.toAppError() }
}
