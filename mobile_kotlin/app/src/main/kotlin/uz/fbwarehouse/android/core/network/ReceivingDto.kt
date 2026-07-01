package uz.fbwarehouse.android.core.network

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class LocationDto(
    val id: String,
    val code: String,
    val name: String,
    @SerialName("zone_type") val zoneType: String = "NORMAL",
    @SerialName("is_active") val isActive: Boolean = true,
)

@Serializable
data class ReceiptLineCreateDto(
    @SerialName("product_id") val productId: String,
    val qty: Int,
    @SerialName("location_id") val locationId: String,
    val batch: String? = null,
    @SerialName("expiry_date") val expiryDate: String? = null,
    @SerialName("box_barcode") val boxBarcode: String? = null,
    @SerialName("box_count") val boxCount: Int? = null,
)

@Serializable
data class ReceiptCreateDto(
    val lines: List<ReceiptLineCreateDto>,
    val complete: Boolean = true,
)

@Serializable
data class ReceiptLineOutDto(
    val id: String,
    @SerialName("product_id") val productId: String,
    val qty: Double,
    val batch: String,
    @SerialName("location_id") val locationId: String,
)

@Serializable
data class ReceiptOutDto(
    val id: String,
    @SerialName("doc_no") val docNo: String,
    val status: String,
    val lines: List<ReceiptLineOutDto> = emptyList(),
)
