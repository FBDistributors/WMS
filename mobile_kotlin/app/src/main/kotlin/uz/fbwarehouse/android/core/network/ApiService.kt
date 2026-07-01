package uz.fbwarehouse.android.core.network

import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.Header
import retrofit2.http.POST
import retrofit2.http.Path
import retrofit2.http.Query

interface ApiService {
    @POST("auth/login")
    suspend fun login(@Body body: LoginRequest): TokenResponse

    @GET("auth/me")
    suspend fun me(): MeResponse

    @POST("auth/logout")
    suspend fun logout()

    @GET("picking/documents")
    suspend fun getPickingDocuments(): List<PickingListItemDto>

    @GET("picking/documents/{id}")
    suspend fun getPickingDocument(@Path("id") id: String): PickingDocumentDto

    @POST("picking/lines/{lineId}/pick")
    suspend fun pickLine(
        @Path("lineId") lineId: String,
        @Body body: PickLineRequestDto,
    ): PickLineResponseDto

    @GET("inventory/by-barcode/{barcode}")
    suspend fun getInventoryByBarcode(@Path("barcode") barcode: String): InventoryByBarcodeDto

    @GET("locations")
    suspend fun getLocations(@Query("warehouse") warehouse: String? = null): List<LocationDto>

    @POST("receiving/receipts")
    suspend fun createReceipt(@Body body: ReceiptCreateDto): ReceiptOutDto

    @GET("customer-returns")
    suspend fun getCustomerReturns(
        @Query("status") status: String? = null,
        @Query("mine_as_picker") mineAsPicker: Boolean? = null,
    ): CustomerReturnListOutDto

    @GET("customer-returns/{id}")
    suspend fun getCustomerReturn(@Path("id") id: String): CustomerReturnOutDto

    @POST("customer-returns/{id}/controller-approve")
    suspend fun approveCustomerReturn(@Path("id") id: String): CustomerReturnOutDto

    @POST("customer-returns/{id}/assign-picker")
    suspend fun assignPickerToCustomerReturn(
        @Path("id") id: String,
        @Body body: AssignPickerRequestDto,
    ): CustomerReturnOutDto

    @POST("customer-returns/{id}/complete")
    suspend fun completeCustomerReturn(
        @Path("id") id: String,
        @Body body: CompleteCustomerReturnRequestDto,
    ): CustomerReturnOutDto

    @GET("picking/pickers")
    suspend fun getPickers(): List<PickerUserDto>

    @POST("auth/change-password")
    suspend fun changePassword(@Body body: ChangePasswordRequestDto): StatusResponseDto

    @POST("app-feedback")
    suspend fun submitAppFeedback(@Body body: AppFeedbackCreateDto): AppFeedbackOutDto

    @POST("inventory/movements/transfer-location")
    suspend fun transferLocationStock(
        @Body body: LocationTransferRequestDto,
        @Header("Idempotency-Key") idempotencyKey: String,
    ): LocationTransferResponseDto
}
