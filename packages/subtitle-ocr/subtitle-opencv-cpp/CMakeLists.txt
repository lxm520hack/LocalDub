cmake_minimum_required(VERSION 3.10)
project(ocr_pipeline_opencv CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_FLAGS_RELEASE "-O3 -DNDEBUG")
if(NOT CMAKE_BUILD_TYPE)
    set(CMAKE_BUILD_TYPE Release)
endif()

# --- ORT ---------------------------------------------------------------------
set(ORT_DIR "" CACHE PATH "Path to onnxruntime installation (containing include/ and lib/)")
if(NOT ORT_DIR)
    if(WIN32)
        set(ORT_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../../tmp/onnxruntime-win-x64-1.26.0/onnxruntime-win-x64-1.26.0")
    else()
        # Prefer the ORT copy bundled with this project under packages/tmp/
        if(EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/../../tmp/onnxruntime-linux-x64-1.24.4")
            set(ORT_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../../tmp/onnxruntime-linux-x64-1.24.4")
        elseif(EXISTS "/tmp/onnxruntime-linux-x64-1.24.4")
            set(ORT_DIR "/tmp/onnxruntime-linux-x64-1.24.4")
        endif()
    endif()
endif()
set(ORT_INCLUDE_DIR "${ORT_DIR}/include")
set(ORT_LIB_DIR "${ORT_DIR}/lib")

# --- OpenCV ------------------------------------------------------------------
# We explicitly name only the modules we need so that the linker does not
# try to pull in the optional OpenCV modules `opencv_viz` / `opencv_hdf` —
# those need system VTK / HDF5 libraries which are not always available.
#
# Components used:
#   opencv_core         — cv::Mat, cv::Point, cv::Scalar
#   opencv_imgproc      — cv::dilate, cv::findContours, cv::minAreaRect,
#                         cv::boxPoints, cv::fillPoly, cv::mean, resize,
#                         cv::getPerspectiveTransform, cv::warpPerspective,
#                         cv::rotate
#   opencv_imgcodecs    — (optional) imread / imwrite for debugging images
find_package(OpenCV QUIET COMPONENTS core imgproc imgcodecs)
if(NOT OpenCV_FOUND)
    message(FATAL_ERROR "OpenCV (core, imgproc, imgcodecs) not found. Install libopencv-dev or set OpenCV_DIR.")
endif()
message(STATUS "OpenCV version: ${OpenCV_VERSION}")
message(STATUS "OpenCV include dirs: ${OpenCV_INCLUDE_DIRS}")
message(STATUS "OpenCV libs: ${OpenCV_LIBS}")

# --- Build executable --------------------------------------------------------
add_executable(ocr_pipeline_opencv ocr_pipeline.cpp)

target_include_directories(ocr_pipeline_opencv PRIVATE
    "${ORT_INCLUDE_DIR}"
    "${CMAKE_CURRENT_SOURCE_DIR}"
)

target_link_directories(ocr_pipeline_opencv PRIVATE "${ORT_LIB_DIR}")

if(WIN32)
    find_library(ONNXRUNTIME_LIB onnxruntime PATHS "${ORT_LIB_DIR}" NO_DEFAULT_PATH)
    target_link_libraries(ocr_pipeline_opencv PRIVATE ${ONNXRUNTIME_LIB})
    add_custom_command(TARGET ocr_pipeline_opencv POST_BUILD
        COMMAND ${CMAKE_COMMAND} -E copy_if_different
            "${ORT_LIB_DIR}/onnxruntime.dll"
            "$<TARGET_FILE_DIR:ocr_pipeline_opencv>/"
        COMMAND ${CMAKE_COMMAND} -E copy_if_different
            "${ORT_LIB_DIR}/onnxruntime_providers_shared.dll"
            "$<TARGET_FILE_DIR:ocr_pipeline_opencv>/"
        COMMENT "Copying ORT DLLs"
    )
else()
    find_library(ONNXRUNTIME_LIB onnxruntime PATHS "${ORT_LIB_DIR}" NO_DEFAULT_PATH)
    target_link_libraries(ocr_pipeline_opencv PRIVATE ${ONNXRUNTIME_LIB} pthread)
    add_custom_command(TARGET ocr_pipeline_opencv POST_BUILD
        COMMAND ${CMAKE_COMMAND} -E copy_if_different
            "${ORT_LIB_DIR}/libonnxruntime.so.1.24.4"
            "$<TARGET_FILE_DIR:ocr_pipeline_opencv>/libonnxruntime.so.1"
        COMMENT "Copying ORT shared library"
    )
endif()

# Link OpenCV (after ORT to avoid symbol conflicts)
target_link_libraries(ocr_pipeline_opencv PRIVATE ${OpenCV_LIBS})
