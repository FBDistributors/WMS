package uz.fbwarehouse.android.core.network

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class LocationTransferRequestDto(
    @SerialName("from_location_id") val fromLocationId: String,
    @SerialName("to_location_id") val toLocationId: String,
    val mode: String = "full",
)

@Serializable
data class LocationTransferResponseDto(
    @SerialName("lines_transferred") val linesTransferred: Int,
    @SerialName("movements_created") val movementsCreated: Int,
    @SerialName("lines_requested") val linesRequested: Int = 0,
)
