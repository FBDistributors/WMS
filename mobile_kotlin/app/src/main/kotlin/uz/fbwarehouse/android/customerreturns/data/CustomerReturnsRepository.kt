package uz.fbwarehouse.android.customerreturns.data

import uz.fbwarehouse.android.core.network.ApiService
import uz.fbwarehouse.android.core.network.AssignPickerRequestDto
import uz.fbwarehouse.android.core.network.CompleteCustomerReturnRequestDto
import uz.fbwarehouse.android.core.network.CustomerReturnOutDto
import uz.fbwarehouse.android.core.network.PickerUserDto
import uz.fbwarehouse.android.core.network.toAppError
import javax.inject.Inject
import javax.inject.Singleton

/** Controllerga tekshirish kutayotgan mijoz qaytarishlari statusi (backend: pending_controller). */
private const val STATUS_PENDING_CONTROLLER = "pending_controller"

@Singleton
class CustomerReturnsRepository @Inject constructor(
    private val apiService: ApiService,
) {
    suspend fun listPendingApproval(): Result<List<CustomerReturnOutDto>> = runCatching {
        apiService.getCustomerReturns(status = STATUS_PENDING_CONTROLLER).items
    }.recoverCatching { throw it.toAppError() }

    /** Menga (picker) biriktirilgan, hali qabul qilib olinmagan qaytarishlar. */
    suspend fun listAssignedToMe(): Result<List<CustomerReturnOutDto>> = runCatching {
        apiService.getCustomerReturns(mineAsPicker = true).items
    }.recoverCatching { throw it.toAppError() }

    suspend fun getReturn(id: String): Result<CustomerReturnOutDto> = runCatching {
        apiService.getCustomerReturn(id)
    }.recoverCatching { throw it.toAppError() }

    suspend fun approve(id: String): Result<CustomerReturnOutDto> = runCatching {
        apiService.approveCustomerReturn(id)
    }.recoverCatching { throw it.toAppError() }

    suspend fun listPickers(): Result<List<PickerUserDto>> = runCatching {
        apiService.getPickers()
    }.recoverCatching { throw it.toAppError() }

    suspend fun assignPicker(returnId: String, pickerUserId: String): Result<CustomerReturnOutDto> = runCatching {
        apiService.assignPickerToCustomerReturn(returnId, AssignPickerRequestDto(pickerUserId = pickerUserId))
    }.recoverCatching { throw it.toAppError() }

    suspend fun complete(returnId: String, locationId: String): Result<CustomerReturnOutDto> = runCatching {
        apiService.completeCustomerReturn(returnId, CompleteCustomerReturnRequestDto(locationId = locationId))
    }.recoverCatching { throw it.toAppError() }
}
