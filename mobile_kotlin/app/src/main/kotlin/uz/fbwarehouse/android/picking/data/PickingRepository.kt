package uz.fbwarehouse.android.picking.data

import uz.fbwarehouse.android.core.db.PendingPickDao
import uz.fbwarehouse.android.core.db.PendingPickEntity
import uz.fbwarehouse.android.core.network.AppError
import uz.fbwarehouse.android.core.network.ApiService
import uz.fbwarehouse.android.core.network.PickLineRequestDto
import uz.fbwarehouse.android.core.network.PickLineResponseDto
import uz.fbwarehouse.android.core.network.PickingDocumentDto
import uz.fbwarehouse.android.core.network.PickingListItemDto
import uz.fbwarehouse.android.core.network.toAppError
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class PickingRepository @Inject constructor(
    private val apiService: ApiService,
    private val pendingPickDao: PendingPickDao,
) {
    /** Bitta pick urinishining natijasi: serverga darhol yetdimi yoki tarmoq yo'qligi sababli navbatga qo'yildimi. */
    sealed class PickOutcome {
        data class Synced(val response: PickLineResponseDto) : PickOutcome()
        data object Queued : PickOutcome()
    }

    suspend fun listDocuments(): Result<List<PickingListItemDto>> = runCatching {
        apiService.getPickingDocuments()
    }.recoverCatching { throw it.toAppError() }

    suspend fun getDocument(id: String): Result<PickingDocumentDto> = runCatching {
        apiService.getPickingDocument(id)
    }.recoverCatching { throw it.toAppError() }

    /**
     * `delta` — shu terishga qo'shiladigan dona (manfiy bo'lsa unpick sifatida ham ishlaydi backendda).
     * Tarmoq yo'qligi sababli so'rov yetib bormasa, amal lokal navbatga saqlanadi (Queued) — foydalanuvchi
     * internetsiz ham terishni davom ettiraveradi, keyinroq (`syncPendingPicks`) avtomatik yuboriladi.
     */
    suspend fun pickLine(
        lineId: String,
        delta: Int,
        barcode: String? = null,
        boxCount: Int? = null,
    ): Result<PickOutcome> {
        val requestId = UUID.randomUUID().toString()
        val attempt = runCatching {
            apiService.pickLine(
                lineId,
                PickLineRequestDto(delta = delta, requestId = requestId, barcode = barcode, boxCount = boxCount),
            )
        }
        return attempt.fold(
            onSuccess = { response -> Result.success(PickOutcome.Synced(response)) },
            onFailure = { e ->
                val appError = e.toAppError()
                if (appError is AppError.Network) {
                    pendingPickDao.insert(
                        PendingPickEntity(
                            lineId = lineId,
                            delta = delta,
                            barcode = barcode,
                            requestId = requestId,
                            createdAtMillis = System.currentTimeMillis(),
                            boxCount = boxCount,
                        )
                    )
                    Result.success(PickOutcome.Queued)
                } else {
                    Result.failure(appError)
                }
            },
        )
    }

    /**
     * Navbatdagi pick amallarini eskisidan boshlab yuborishga urinadi. Birinchi muvaffaqiyatsizlikda
     * to'xtaydi (hali ham tarmoq yo'q bo'lsa) — tartibni buzmaslik uchun.
     * Returns: muvaffaqiyatli sinxronlangan amallar soni.
     */
    suspend fun syncPendingPicks(): Int {
        val pending = pendingPickDao.getAllOrdered()
        var syncedCount = 0
        for (item in pending) {
            val result = runCatching {
                apiService.pickLine(
                    item.lineId,
                    PickLineRequestDto(
                        delta = item.delta,
                        requestId = item.requestId,
                        barcode = item.barcode,
                        boxCount = item.boxCount,
                    ),
                )
            }
            if (result.isSuccess) {
                pendingPickDao.delete(item)
                syncedCount++
            } else {
                break
            }
        }
        return syncedCount
    }
}
