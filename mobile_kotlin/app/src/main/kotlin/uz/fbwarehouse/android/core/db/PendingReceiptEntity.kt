package uz.fbwarehouse.android.core.db

import androidx.room.Entity
import androidx.room.PrimaryKey

/**
 * Tarmoq yo'qligi sababli darhol yuborilmagan qabul hujjati — internet qaytganda sinxronlanadi.
 * Qatorlar ro'yxati JSON qatori sifatida saqlanadi (Room uchun oddiy tur, alohida jadval kerak emas).
 */
@Entity(tableName = "pending_receipts")
data class PendingReceiptEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val linesJson: String,
    val createdAtMillis: Long,
)
