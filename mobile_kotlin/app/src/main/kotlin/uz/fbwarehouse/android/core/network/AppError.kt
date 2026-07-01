package uz.fbwarehouse.android.core.network

import kotlinx.serialization.json.Json
import okhttp3.ResponseBody
import retrofit2.HttpException
import java.io.IOException

/** Backend/tarmoq xatolarini UI qatlami tushunadigan turga aylantiradi (Flutter mapDioExceptionToMessage bilan bir xil g'oya). */
sealed class AppError : Exception() {
    data object InvalidCredentials : AppError()
    data object RateLimited : AppError()
    data object Unauthorized : AppError()
    data object Network : AppError()
    data object NotFound : AppError()
    data class Server(val detail: String?) : AppError()
    data class Unknown(val detail: String?) : AppError()
}

private val errorJson = Json { ignoreUnknownKeys = true }

fun Throwable.toAppError(): AppError {
    return when (this) {
        is HttpException -> {
            val detail = extractDetail(response()?.errorBody())
            when (code()) {
                401 -> if (detail?.contains("Invalid credentials", ignoreCase = true) == true) {
                    AppError.InvalidCredentials
                } else {
                    AppError.Unauthorized
                }
                404 -> AppError.NotFound
                429 -> AppError.RateLimited
                in 500..599 -> AppError.Server(detail)
                else -> AppError.Unknown(detail)
            }
        }
        is IOException -> AppError.Network
        else -> AppError.Unknown(message)
    }
}

private fun extractDetail(errorBody: ResponseBody?): String? {
    val raw = errorBody?.string() ?: return null
    return try {
        errorJson.decodeFromString(ApiErrorBody.serializer(), raw).detail
    } catch (_: Exception) {
        null
    }
}
