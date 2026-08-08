# The planner is a single HTML asset; there is almost nothing to keep.
#
# Except this. The page reaches the Play Integrity bridge by name, from
# JavaScript, which R8 cannot see — nothing in the Kotlin ever calls
# Attest.request(), so to the shrinker it is dead code. Stripped, the release
# build would attest nothing, the service would refuse it, and every user would
# quietly drop to the open charger sources. Debug builds would keep working,
# which is the worst version of this bug.
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
