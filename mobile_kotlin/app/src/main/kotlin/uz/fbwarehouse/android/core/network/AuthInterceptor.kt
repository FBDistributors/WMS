package uz.fbwarehouse.android.core.network

import kotlinx.coroutines.runBlocking
import okhttp3.Interceptor
import okhttp3.Response
import uz.fbwarehouse.android.core.storage.TokenDataStore
import javax.inject.Inject

/** Har so'rovga Bearer token qo'shadi; 401 kelsa saqlangan token'ni tozalaydi (Flutter app_dio.dart bilan bir xil naqsh). */
class AuthInterceptor @Inject constructor(
    private val tokenDataStore: TokenDataStore,
) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val token = tokenDataStore.readTokenBlocking()
        val request = if (!token.isNullOrBlank()) {
            chain.request().newBuilder()
                .addHeader("Authorization", "Bearer $token")
                .build()
        } else {
            chain.request()
        }

        val response = chain.proceed(request)
        if (response.code == 401) {
            runBlocking { tokenDataStore.clearToken() }
        }
        return response
    }
}
