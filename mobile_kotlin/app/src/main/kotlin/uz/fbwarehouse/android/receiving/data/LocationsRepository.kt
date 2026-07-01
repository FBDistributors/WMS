package uz.fbwarehouse.android.receiving.data

import uz.fbwarehouse.android.core.network.ApiService
import uz.fbwarehouse.android.core.network.LocationDto
import uz.fbwarehouse.android.core.network.toAppError
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class LocationsRepository @Inject constructor(
    private val apiService: ApiService,
) {
    suspend fun listActiveLocations(warehouse: String = "main"): Result<List<LocationDto>> = runCatching {
        apiService.getLocations(warehouse).filter { it.isActive }
    }.recoverCatching { throw it.toAppError() }
}
