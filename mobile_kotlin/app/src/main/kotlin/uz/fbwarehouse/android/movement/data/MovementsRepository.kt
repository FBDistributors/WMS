package uz.fbwarehouse.android.movement.data

import uz.fbwarehouse.android.core.network.ApiService
import uz.fbwarehouse.android.core.network.LocationTransferRequestDto
import uz.fbwarehouse.android.core.network.LocationTransferResponseDto
import uz.fbwarehouse.android.core.network.toAppError
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class MovementsRepository @Inject constructor(
    private val apiService: ApiService,
) {
    /** Manba joydagi barcha qutisiz (loose) zaxirani manzil joyga ko'chiradi (yopiq qutilar joyida qoladi). */
    suspend fun transferAllLoose(
        fromLocationId: String,
        toLocationId: String,
    ): Result<LocationTransferResponseDto> = runCatching {
        apiService.transferLocationStock(
            body = LocationTransferRequestDto(
                fromLocationId = fromLocationId,
                toLocationId = toLocationId,
                mode = "full",
            ),
            idempotencyKey = UUID.randomUUID().toString(),
        )
    }.recoverCatching { throw it.toAppError() }
}
