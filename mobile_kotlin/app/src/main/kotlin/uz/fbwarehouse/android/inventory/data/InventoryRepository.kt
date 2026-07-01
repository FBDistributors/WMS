package uz.fbwarehouse.android.inventory.data

import uz.fbwarehouse.android.core.network.ApiService
import uz.fbwarehouse.android.core.network.InventoryByBarcodeDto
import uz.fbwarehouse.android.core.network.toAppError
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class InventoryRepository @Inject constructor(
    private val apiService: ApiService,
) {
    suspend fun searchByBarcode(barcode: String): Result<InventoryByBarcodeDto> = runCatching {
        apiService.getInventoryByBarcode(barcode)
    }.recoverCatching { throw it.toAppError() }
}
