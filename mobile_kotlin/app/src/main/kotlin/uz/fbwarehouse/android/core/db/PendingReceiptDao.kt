package uz.fbwarehouse.android.core.db

import androidx.room.Dao
import androidx.room.Delete
import androidx.room.Insert
import androidx.room.Query

@Dao
interface PendingReceiptDao {
    @Insert
    suspend fun insert(entity: PendingReceiptEntity): Long

    @Query("SELECT * FROM pending_receipts ORDER BY createdAtMillis ASC")
    suspend fun getAllOrdered(): List<PendingReceiptEntity>

    @Query("SELECT COUNT(*) FROM pending_receipts")
    suspend fun count(): Int

    @Delete
    suspend fun delete(entity: PendingReceiptEntity)
}
