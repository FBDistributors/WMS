package uz.fbwarehouse.android.core.db

import androidx.room.Entity
import androidx.room.PrimaryKey

/** Tarmoq yo'qligi sababli darhol yuborilmagan terish amali — internet qaytganda sinxronlanadi. */
@Entity(tableName = "pending_picks")
data class PendingPickEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val lineId: String,
    val delta: Int,
    val barcode: String?,
    val requestId: String,
    val createdAtMillis: Long,
    val boxCount: Int? = null,
)
