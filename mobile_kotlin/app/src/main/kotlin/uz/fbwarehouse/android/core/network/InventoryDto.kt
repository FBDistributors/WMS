package uz.fbwarehouse.android.core.network

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class ByBarcodeLocationInfoDto(
    @SerialName("location_code") val locationCode: String,
    @SerialName("available_qty") val availableQty: Double,
)

@Serializable
data class ByBarcodeLotInfoDto(
    @SerialName("batch_no") val batchNo: String,
    @SerialName("expiry_date") val expiryDate: String? = null,
    @SerialName("available_qty") val availableQty: Double,
)

@Serializable
data class InventoryByBarcodeDto(
    @SerialName("product_id") val productId: String,
    val name: String,
    val barcode: String? = null,
    val brand: String? = null,
    @SerialName("best_locations") val bestLocations: List<ByBarcodeLocationInfoDto> = emptyList(),
    @SerialName("fefo_lots") val fefoLots: List<ByBarcodeLotInfoDto> = emptyList(),
    @SerialName("total_available") val totalAvailable: Double,
    /** "unit" — dona shtrix-kod skanerlandi, "box" — yopiq quti shtrix-kodi skanerlandi. */
    @SerialName("scan_kind") val scanKind: String = "unit",
    @SerialName("units_per_box") val unitsPerBox: Int? = null,
    @SerialName("box_barcode") val boxBarcode: String? = null,
)
