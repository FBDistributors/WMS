package uz.fbwarehouse.android.core.network

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class CustomerReturnLineOutDto(
    val id: String,
    @SerialName("product_id") val productId: String,
    @SerialName("product_name") val productName: String,
    @SerialName("location_code") val locationCode: String,
    val qty: Double,
    val batch: String,
    @SerialName("expiry_date") val expiryDate: String? = null,
)

@Serializable
data class CustomerReturnOutDto(
    val id: String,
    @SerialName("doc_no") val docNo: String,
    @SerialName("customer_name") val customerName: String? = null,
    @SerialName("reason_code") val reasonCode: String? = null,
    val status: String,
    val lines: List<CustomerReturnLineOutDto> = emptyList(),
)

@Serializable
data class CustomerReturnListOutDto(
    val items: List<CustomerReturnOutDto>,
    val total: Int,
)

@Serializable
data class PickerUserDto(
    val id: String,
    val username: String,
    @SerialName("full_name") val fullName: String? = null,
)

@Serializable
data class AssignPickerRequestDto(
    @SerialName("picker_user_id") val pickerUserId: String,
)

@Serializable
data class CompleteCustomerReturnRequestDto(
    @SerialName("location_id") val locationId: String? = null,
)
