package uz.fbwarehouse.android.core.network

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class PickingListItemDto(
    val id: String,
    @SerialName("reference_number") val referenceNumber: String,
    val status: String,
    @SerialName("lines_total") val linesTotal: Int,
    @SerialName("lines_done") val linesDone: Int,
    @SerialName("order_number") val orderNumber: String? = null,
    @SerialName("customer_name") val customerName: String? = null,
)

@Serializable
data class PickingProgressDto(
    val picked: Double,
    val required: Double,
)

@Serializable
data class PickingLineDto(
    val id: String,
    @SerialName("product_id") val productId: String? = null,
    @SerialName("product_name") val productName: String,
    val sku: String? = null,
    val barcode: String? = null,
    @SerialName("location_code") val locationCode: String,
    val batch: String? = null,
    @SerialName("expiry_date") val expiryDate: String? = null,
    @SerialName("qty_required") val qtyRequired: Double,
    @SerialName("qty_picked") val qtyPicked: Double,
    @SerialName("skip_reason") val skipReason: String? = null,
    @SerialName("is_vip_expiry_informational") val isVipExpiryInformational: Boolean = false,
    @SerialName("line_source") val lineSource: String? = "product",
)

@Serializable
data class PickingDocumentDto(
    val id: String,
    @SerialName("reference_number") val referenceNumber: String,
    val status: String,
    val lines: List<PickingLineDto>,
    val progress: PickingProgressDto,
    @SerialName("order_number") val orderNumber: String? = null,
    @SerialName("customer_name") val customerName: String? = null,
)

@Serializable
data class PickLineRequestDto(
    val delta: Int,
    @SerialName("request_id") val requestId: String,
    val barcode: String? = null,
    @SerialName("box_count") val boxCount: Int? = null,
)

@Serializable
data class PickLineResponseDto(
    val line: PickingLineDto,
    val progress: PickingProgressDto,
    @SerialName("document_status") val documentStatus: String,
)
