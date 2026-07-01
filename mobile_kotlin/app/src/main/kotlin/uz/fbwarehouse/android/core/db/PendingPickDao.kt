package uz.fbwarehouse.android.core.db

import androidx.room.Dao
import androidx.room.Delete
import androidx.room.Insert
import androidx.room.Query

@Dao
interface PendingPickDao {
    @Insert
    suspend fun insert(entity: PendingPickEntity): Long

    /** Yaratilgan tartibda — eski amallar birinchi sinxronlanishi kerak. */
    @Query("SELECT * FROM pending_picks ORDER BY createdAtMillis ASC")
    suspend fun getAllOrdered(): List<PendingPickEntity>

    @Query("SELECT COUNT(*) FROM pending_picks")
    suspend fun count(): Int

    @Delete
    suspend fun delete(entity: PendingPickEntity)
}
