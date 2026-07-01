package uz.fbwarehouse.android.receiving.data

import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import uz.fbwarehouse.android.core.db.PendingReceiptDao
import uz.fbwarehouse.android.core.db.PendingReceiptEntity
import uz.fbwarehouse.android.core.network.AppError
import uz.fbwarehouse.android.core.network.ApiService
import uz.fbwarehouse.android.core.network.ReceiptCreateDto
import uz.fbwarehouse.android.core.network.ReceiptLineCreateDto
import uz.fbwarehouse.android.core.network.ReceiptOutDto
import uz.fbwarehouse.android.core.network.toAppError
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class ReceivingRepository @Inject constructor(
    private val apiService: ApiService,
    private val pendingReceiptDao: PendingReceiptDao,
    private val json: Json,
) {
    /** Bitta qabul urinishining natijasi: serverga darhol yetdimi yoki navbatga qo'yildimi. */
    sealed class ReceiveOutcome {
        data class Synced(val response: ReceiptOutDto) : ReceiveOutcome()
        data object Queued : ReceiveOutcome()
    }

    /**
     * Bir yoki bir nechta qatorli qabul: yaratish + yakunlash bitta atomik so'rovda (backend
     * `complete=true`). Tarmoq yo'qligi sababli yetib bormasa, butun hujjat lokal navbatga
     * saqlanadi — internet qaytganda (`syncPendingReceipts`) avtomatik yuboriladi.
     */
    suspend fun receiveLines(lines: List<ReceiptLineCreateDto>): Result<ReceiveOutcome> {
        val attempt = runCatching {
            apiService.createReceipt(ReceiptCreateDto(lines = lines, complete = true))
        }
        return attempt.fold(
            onSuccess = { response -> Result.success(ReceiveOutcome.Synced(response)) },
            onFailure = { e ->
                val appError = e.toAppError()
                if (appError is AppError.Network) {
                    pendingReceiptDao.insert(
                        PendingReceiptEntity(
                            linesJson = json.encodeToString(lines),
                            createdAtMillis = System.currentTimeMillis(),
                        )
                    )
                    Result.success(ReceiveOutcome.Queued)
                } else {
                    Result.failure(appError)
                }
            },
        )
    }

    /**
     * Navbatdagi qabul hujjatlarini eskisidan boshlab yuborishga urinadi. Birinchi
     * muvaffaqiyatsizlikda to'xtaydi (hali ham tarmoq yo'q bo'lsa).
     * Returns: muvaffaqiyatli sinxronlangan hujjatlar soni.
     */
    suspend fun syncPendingReceipts(): Int {
        val pending = pendingReceiptDao.getAllOrdered()
        var syncedCount = 0
        for (item in pending) {
            val lines = runCatching {
                json.decodeFromString(ListSerializer(ReceiptLineCreateDto.serializer()), item.linesJson)
            }.getOrNull()
            if (lines == null) {
                // Buzilgan yozuv — cheksiz qayta urinishning oldini olish uchun o'chiramiz.
                pendingReceiptDao.delete(item)
                continue
            }
            val result = runCatching {
                apiService.createReceipt(ReceiptCreateDto(lines = lines, complete = true))
            }
            if (result.isSuccess) {
                pendingReceiptDao.delete(item)
                syncedCount++
            } else {
                break
            }
        }
        return syncedCount
    }
}
